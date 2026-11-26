import { describe, it, expect, afterEach } from 'vitest';
import { harness, studentHash, mcqAns, natAns, T0, at, min, PRACTICE_SOLUTION, RECEIPT_VALUE, ORIGIN, type Harness } from './harness.js';
import { ROUTE_PATTERNS, routePath, safeReturnPath } from '../../../../shared/api-contract.js';
import { statusFor } from '../errors.js';
import type { BrainErrorCode } from '../../errors.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

describe('/health', () => {
  it('needs no cookie, reports pack, schema, db and DeepTutor reachability', async () => {
    h = await harness();
    const r = await h.call('GET', '/health', { as: 'nobody' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, pack_version: 'pack-test-1', db_writable: true, deeptutor_auth_reachable: true, mock_form: 'ready', build_id: 'build-test' });
    expect(r.headers.get('x-vidhya-build')).toBe('build-test');
    expect(h.authCalls.some((c) => c.includes('dt_token'))).toBe(false); // the probe carries no cookie
  });
  it('says so when DeepTutor is down but stays 200 while the DB is fine', async () => {
    h = await harness();
    h.authMode.value = 'down';
    const r = await h.call('GET', '/health', { as: 'nobody' });
    expect(r.json.deeptutor_auth_reachable).toBe(false);
  });
});

describe('identity: only the dt_token cookie, validated by DeepTutor (R1, R7-1)', () => {
  it('no cookie -> 401 SessionMissing as {code, message}', async () => {
    h = await harness();
    const r = await h.call('GET', '/v1/session', { as: 'nobody' });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ code: 'SessionMissing', message: 'no dt_token cookie' });
  });
  it('a token DeepTutor rejects -> 401; an account that is not enrolled -> 403 UnknownStudent', async () => {
    h = await harness();
    expect((await h.call('GET', '/v1/session', { as: 'x' })).status).toBe(403); // tok-x is authenticated but not in the registry
    expect((await h.call('GET', '/v1/session', { as: 'nobody' })).status).toBe(401);
  });
  it('DeepTutor down -> 503 AuthUpstreamUnavailable', async () => {
    h = await harness();
    h.authMode.value = 'down';
    const r = await h.call('GET', '/v1/session');
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('AuthUpstreamUnavailable');
  });
  it('the session route returns the signed-in student; a student id in the query or body is ignored', async () => {
    h = await harness();
    const r = await h.call('GET', `/v1/session?student_id=${studentHash('s2')}&studentId=${studentHash('s2')}`);
    expect(r.json).toMatchObject({ studentId: studentHash('s1'), entitled: true, buildId: 'build-test' });
    await h.call('GET', '/v1/items/p1');
    const c = await h.call('POST', '/v1/items/p1/check', { body: { answer: mcqAns('B'), student_id: studentHash('s2'), studentId: studentHash('s2') } });
    expect(c.status).toBe(200);
    const rows = h.db.prepare('SELECT student_hash FROM attempts').all();
    expect(rows).toEqual([{ student_hash: studentHash('s1') }]);
  });
});

describe('E9: Cache-Control on every response; return paths stay under /exam/', () => {
  it('private, no-store on success, errors, redirects, 404, 405 and /health', async () => {
    h = await harness();
    const many = [
      await h.call('GET', '/v1/session'),
      await h.call('GET', '/v1/session', { as: 'nobody' }),
      await h.call('GET', '/v1/nope'),
      await h.call('DELETE', '/v1/today'),
      await h.call('POST', '/v1/report', { origin: null, body: {} }),
      await h.call('GET', '/v1/login?return=/exam/mock'),
      await h.call('GET', '/health', { as: 'nobody' }),
      await h.call('GET', '/elsewhere', { as: 'nobody' }),
      await h.call('GET', '/mcp', { as: 'nobody' }),
    ];
    for (const r of many) expect(r.headers.get('cache-control'), `${r.status}`).toBe('private, no-store');
    expect(many.map((r) => r.status)).toEqual([200, 401, 404, 405, 403, 302, 200, 404, 405]);
  });

  it.each([
    ['/exam/mock', '/exam/mock'],
    ['/exam/', '/exam/'],
    ['/exam/practice?x=1', '/exam/practice?x=1'],
    ['/exam', '/exam/'],
    ['//evil.example/exam/', '/exam/'],
    ['https://evil.example/', '/exam/'],
    ['/exam/../admin', '/exam/'],
    ['/exam/%2e%2e/admin', '/exam/'],
    ['/exam/\\evil', '/exam/'],
    ['/exam/%5Cevil', '/exam/'],
    ['/exam/\r\nSet-Cookie: x=1', '/exam/'],
    ['/examination', '/exam/'],
    ['/login', '/exam/'],
    ['', '/exam/'],
  ])('safeReturnPath(%j) -> %j', (raw, want) => {
    expect(safeReturnPath(raw)).toBe(want);
  });
  it('safeReturnPath refuses non-strings and very long paths', () => {
    expect(safeReturnPath(undefined)).toBe('/exam/');
    expect(safeReturnPath(null)).toBe('/exam/');
    expect(safeReturnPath(`/exam/${'a'.repeat(600)}`)).toBe('/exam/');
  });
  it('GET /v1/login redirects to the login page carrying only a safe return path', async () => {
    h = await harness();
    const ok = await h.call('GET', `/v1/login?return=${encodeURIComponent('/exam/mock')}`, { as: 'nobody' });
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/login?return=%2Fexam%2Fmock');
    const bad = await h.call('GET', `/v1/login?return=${encodeURIComponent('https://evil.example/')}`, { as: 'nobody' });
    expect(bad.headers.get('location')).toBe('/login?return=%2Fexam%2F');
    const bad2 = await h.call('GET', `/v1/login?return=${encodeURIComponent('//evil.example')}`, { as: 'nobody' });
    expect(bad2.headers.get('location')).toBe('/login?return=%2Fexam%2F');
  });
});

describe('writes: Origin, JSON, size (CSRF, R7-5)', () => {
  it('refuses a write without or with the wrong Origin, non-JSON bodies, broken JSON and huge bodies', async () => {
    h = await harness();
    await h.call('GET', '/v1/items/p1');
    const body = { answer: mcqAns('B') };
    expect((await h.call('POST', '/v1/items/p1/check', { body, origin: null })).json.code).toBe('OriginRejected');
    expect((await h.call('POST', '/v1/items/p1/check', { body, origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.call('POST', '/v1/items/p1/check', { body, contentType: 'text/plain' })).status).toBe(415);
    expect((await h.call('POST', '/v1/items/p1/check', { body, contentType: null })).status).toBe(415);
    expect((await h.call('POST', '/v1/items/p1/check', { raw: '{not json' })).json.code).toBe('BadRequest');
    expect((await h.call('POST', '/v1/items/p1/check', { raw: JSON.stringify({ pad: 'x'.repeat(70_000) }) })).status).toBe(413);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM attempts').get()).toEqual({ n: 0 });
    expect((await h.call('POST', '/v1/items/p1/check', { body })).status).toBe(200);
  });
});

describe('error mapping', () => {
  it('every BrainError code has a status; none is a silent 500 except real server faults', () => {
    const codes: BrainErrorCode[] = ['SessionMissing', 'AccessEnded', 'ItemNotFound', 'RateLimited', 'MockLateSubmit', 'SchemaBehind', 'InvalidResponse'];
    expect(codes.map(statusFor)).toEqual([401, 403, 404, 429, 409, 503, 400]);
  });
  it('unknown routes and methods', async () => {
    h = await harness();
    expect((await h.call('GET', '/v1/nope')).json).toMatchObject({ code: 'NotFound' });
    expect((await h.call('PUT', '/v1/today', { body: {} })).json).toMatchObject({ code: 'MethodNotAllowed' });
    expect((await h.call('POST', '/health', { as: 'nobody', body: {} })).status).toBe(405);
  });
  it('the route table is the contract: every pattern builds a path', () => {
    expect(routePath('check', { itemId: 'p 1' })).toBe('/v1/items/p%201/check');
    expect(routePath('mockAnswer', { attemptId: 7 })).toBe('/v1/mock/attempts/7/answers');
    expect(Object.keys(ROUTE_PATTERNS).length).toBeGreaterThanOrEqual(18);
    expect(() => routePath('item')).toThrow();
  });
});

describe('rate limit: 60 requests a minute per student, set lower here', () => {
  it('429 after the cap, per student, and the window resets', async () => {
    h = await harness({ rateLimit: 3 });
    for (let i = 0; i < 3; i++) expect((await h.call('GET', '/v1/session')).status).toBe(200);
    const r = await h.call('GET', '/v1/session');
    expect(r.status).toBe(429);
    expect(r.json.code).toBe('RateLimited');
    expect((await h.call('GET', '/v1/session', { as: 's2' })).status).toBe(200);
    h.clock.now = at(T0, min(2));
    expect((await h.call('GET', '/v1/session')).status).toBe(200);
  });
});

describe('practice over HTTP', () => {
  it('today, topics, item serving: stems are escaped and nothing key-shaped arrives before an attempt', async () => {
    h = await harness();
    const today = await h.call('GET', '/v1/today');
    expect(today.status).toBe(200);
    expect(today.json.items.some((i: { kind: string }) => i.kind === 'nat')).toBe(true);
    expect(today.json.estimate).toBeNull();
    expect(today.json.items.map((i: { id: string }) => i.id).every((id: string) => id.startsWith('p'))).toBe(true); // never a mock item
    expect((await h.call('GET', '/v1/topics')).json).toEqual([{ id: 't1', label: 'Linear algebra', natCount: 1 }, { id: 't2', label: 'Calculus', natCount: 0 }]);
    const item = await h.call('GET', '/v1/items/p3');
    expect(item.status).toBe(200);
    expect(item.json).toMatchObject({ id: 'p3', kind: 'nat', marks: 1, negative: '0', topicLabel: 'Linear algebra' });
    expect(item.json.stemHtml).toBe('Practice stem p3 &lt;b&gt;x&lt;/b&gt;');
    expect(item.json.verification).toMatchObject({ state: 'verified', recordFingerprint: item.json.fingerprint, engineLines: ['SymPy', 'Wolfram'] });
    for (const s of [PRACTICE_SOLUTION, RECEIPT_VALUE, 'nat_range', '1.9']) expect(item.text).not.toContain(s);
    const mcq = await h.call('GET', '/v1/items/p1');
    expect(mcq.json.negative).toBe('−⅓');
    expect(mcq.json.options.map((o: { key: string }) => o.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(mcq.text).not.toContain(PRACTICE_SOLUTION);
  });

  it('check: stores the attempt, reveals the key after it, is idempotent, and counts the week', async () => {
    h = await harness();
    await h.call('GET', '/v1/items/p1');
    const a = await h.call('POST', '/v1/items/p1/check', { body: { answer: mcqAns('B'), elapsedMs: 4000, idempotencyKey: 'k1' } });
    expect(a.json).toMatchObject({ status: 'checked', result: { itemId: 'p1', outcome: 'correct', yours: 'B', key: 'B', scored: 1, week: { right: 1, total: 1, topicNoun: 'linear algebra' } } });
    expect(a.json.result.reason).toContain(PRACTICE_SOLUTION);
    const again = await h.call('POST', '/v1/items/p1/check', { body: { answer: mcqAns('B'), idempotencyKey: 'k1' } });
    expect(again.json.result.outcome).toBe('correct');
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM attempts').get()).toEqual({ n: 1 });
    expect(h.db.prepare('SELECT context, source, pack_version FROM attempts').get()).toEqual({ context: 'practice', source: 'brain', pack_version: 'pack-test-1' });
    const wrong = await h.call('POST', '/v1/items/p1/check', { body: { answer: mcqAns('A') } });
    expect(wrong.json.result).toMatchObject({ outcome: 'wrong', scored: -1 / 3, week: null });
  });

  it('NAT and MSQ answers; invalid picks are refused and nothing is stored (R10)', async () => {
    h = await harness();
    await h.call('GET', '/v1/items/p3');
    await h.call('GET', '/v1/items/p2');
    expect((await h.call('POST', '/v1/items/p3/check', { body: { answer: natAns(' 2.05 ') } })).json.result).toMatchObject({ outcome: 'correct', yours: '2.05', key: '1.9 to 2.1' });
    expect((await h.call('POST', '/v1/items/p3/check', { body: { answer: natAns('2,5') } })).json.code).toBe('NatParseError');
    expect((await h.call('POST', '/v1/items/p2/check', { body: { answer: { kind: 'msq', keys: ['A', 'D'] } } })).json.result.outcome).toBe('correct');
    expect((await h.call('POST', '/v1/items/p2/check', { body: { answer: { kind: 'msq', keys: ['A', 'A'] } } })).json.code).toBe('InvalidResponse');
    expect((await h.call('POST', '/v1/items/p2/check', { body: { answer: { kind: 'msq', keys: ['Z'] } } })).json.code).toBe('InvalidResponse');
    expect((await h.call('POST', '/v1/items/p2/check', { body: { answer: mcqAns('A') } })).json.code).toBe('InvalidResponse');
    expect((await h.call('POST', '/v1/items/p2/check', { body: {} })).status).toBe(400);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM attempts').get()).toEqual({ n: 2 });
  });

  it('an answer needs the item to have been served first (409), and a mock item looks like an unknown id (404)', async () => {
    h = await harness();
    expect((await h.call('POST', '/v1/items/p1/check', { body: { answer: mcqAns('B') } })).json.code).toBe('ItemNotServed');
    for (const id of ['m1', 'nope']) {
      const g = await h.call('GET', `/v1/items/${id}`);
      expect(g).toMatchObject({ status: 404 });
      expect(g.json.code).toBe('ItemNotFound');
      expect((await h.call('POST', `/v1/items/${id}/check`, { body: { answer: mcqAns('B') } })).status).toBe(404);
    }
    expect((await h.call('GET', '/v1/topics/t1/items')).json.map((i: { id: string }) => i.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('E12 and the tier flags: judged when the item is served', () => {
  it('served while entitled, answered after entitled_until: counts. Served after: AccessEnded', async () => {
    h = await harness();
    await h.call('GET', '/v1/items/p1', { as: 'expired' }); // 2026-12-13, last entitled day
    h.clock.now = new Date('2026-12-20T10:00:00Z');
    const late = await h.call('POST', '/v1/items/p1/check', { as: 'expired', body: { answer: mcqAns('B') } });
    expect(late.status).toBe(200);
    expect(late.json.result.outcome).toBe('correct');
    const refused = await h.call('GET', '/v1/items/p2', { as: 'expired' });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('AccessEnded');
    expect((await h.call('GET', '/v1/today', { as: 'expired' })).json.code).toBe('AccessEnded');
    expect((await h.call('GET', '/v1/session', { as: 'expired' })).json).toMatchObject({ entitled: false, flags: { nat: false, mock: false, exam_page: true } });
  });
  it('a tier without the nat flag cannot be served NAT, and Today leaves NAT out', async () => {
    h = await harness();
    expect((await h.call('GET', '/v1/items/p3', { as: 'free' })).json.code).toBe('FeatureNotEnabled');
    expect((await h.call('GET', '/v1/items/p1', { as: 'free' })).status).toBe(200);
    expect((await h.call('GET', '/v1/today', { as: 'free' })).json.items.every((i: { kind: string }) => i.kind !== 'nat')).toBe(true);
  });
});

describe('reports and disputes', () => {
  it('a practice report hides the item for the reporter only; two students quarantine it for everyone', async () => {
    h = await harness();
    const r1 = await h.call('POST', '/v1/report', { body: { itemId: 'p1', note: 'key looks wrong', context: 'item' } });
    expect(r1).toMatchObject({ status: 200, json: { ok: true } });
    expect((await h.call('GET', '/v1/items/p1')).status).toBe(404);
    expect((await h.call('GET', '/v1/items/p1', { as: 's2' })).status).toBe(200);
    await h.call('POST', '/v1/report', { as: 's2', body: { itemId: 'p1', note: '', context: 'item' } });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM item_status WHERE status = 'disputed' AND closed_at IS NULL").get()).toEqual({ n: 1 });
    expect((await h.call('GET', '/v1/topics/t1/items', { as: 'free' })).json.map((i: { id: string }) => i.id)).not.toContain('p1');
    expect((await h.call('POST', '/v1/report', { body: { itemId: 'p2', note: 'x'.repeat(281), context: 'item' } })).json.code).toBe('InvalidDispute');
    expect((await h.call('POST', '/v1/report', { body: { itemId: 'p2', note: '', context: 'weird' } })).status).toBe(400);
  });
  it('gap (a) over HTTP: a report filed during the mock does not block a later counted dispute on a practice item', async () => {
    h = await harness();
    // a mock report goes to the queue only
    const start = await h.call('POST', '/v1/mock/attempts', { body: {} });
    expect(start.status).toBe(200);
    const rep = await h.call('POST', '/v1/report', { body: { itemId: 'm1', note: 'hmm', context: 'mock' } });
    expect(rep.json.message).toContain('Sent');
    expect(h.db.prepare("SELECT counted, state FROM disputes WHERE item_id = 'm1'").get()).toEqual({ counted: 0, state: 'giri_queue' });
    // the same student then files a counted dispute for the same item id at the same fingerprint via the DB-level path
    const { fileDispute } = await import('../../disputes/disputes.js');
    const { fingerprint } = await import('../../item/schema.js');
    const out = fileDispute(h.db, { item_id: 'm1', fingerprint: fingerprint(h.pack.byId.get('m1')!), student_hash: studentHash('s1'), channel: 'exam' }, at(T0, min(5)));
    expect(out.outcome).toBe('hidden_for_reporter');
  });
});

describe('marks tab', () => {
  it('states plainly that the range is not available yet', async () => {
    h = await harness();
    const r = await h.call('GET', '/v1/marks');
    expect(r.json.range).toBeNull();
    expect(r.json.basis).toMatch(/mock|30 practice/);
  });
});

describe('origin constant', () => {
  it('the harness uses the configured app origin', () => { expect(ORIGIN).toBe('https://learn.test'); });
});
