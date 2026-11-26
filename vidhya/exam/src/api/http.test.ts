import { describe, it, expect, vi } from 'vitest';
import { HttpExamApi, QUEUE_KEY } from './http';
import { ExamApiError, DOWN_COPY } from './errors';

type Call = { url: string; init: RequestInit };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function setup(handler: (c: Call) => Response | Promise<Response>, o: { buildId?: string; storage?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const redirects: string[] = [];
  const store: Record<string, string> = o.storage ?? {};
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    return handler(c);
  }) as unknown as typeof fetch;
  const api = new HttpExamApi({
    fetchImpl, redirect: (u) => redirects.push(u), currentPath: () => '/exam/mock?x=1', buildId: o.buildId, flushEveryMs: 0, onOnline: () => undefined,
    storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  });
  return { api, calls, redirects, store };
}
const session = { studentId: 'stu-1', flags: {}, entitled: true, buildId: 'b1' };

describe('HttpExamApi transport', () => {
  it('GET: same-origin with credentials, JSON accept, no Origin header, no body', async () => {
    const { api, calls } = setup(() => json([{ id: 't1', label: 'L', natCount: 1 }]));
    expect(await api.listTopics()).toEqual([{ id: 't1', label: 'L', natCount: 1 }]);
    expect(calls[0]!.url).toBe('/v1/topics');
    expect(calls[0]!.init).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(calls[0]!.init.body).toBeUndefined();
    expect(Object.keys(calls[0]!.init.headers as object).map((h) => h.toLowerCase())).not.toContain('origin');
  });
  it('POST: JSON body and content-type; ids are URL-encoded; the student is never in the body', async () => {
    const { api, calls } = setup(() => json({ ok: true, message: 'm' }));
    await api.report('a/b', 'note', 'item');
    expect(calls[0]!.url).toBe('/v1/report');
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ itemId: 'a/b', note: 'note', context: 'item' });
    await setup(() => json([])).api.topicItems('a b/c');
    const s = setup(() => json([]));
    await s.api.topicItems('a b/c');
    expect(s.calls[0]!.url).toBe('/v1/topics/a%20b%2Fc/items');
  });
  it('maps {code, message} errors to ExamApiError', async () => {
    const { api } = setup(() => json({ code: 'FeatureNotEnabled', message: 'mock is not enabled for this account' }, 403));
    const e = await api.getMockBrief().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ExamApiError);
    expect(e).toMatchObject({ code: 'FeatureNotEnabled', status: 403, down: false, message: 'mock is not enabled for this account' });
  });
  it('401 redirects to /v1/login?return=<current /exam/ path> and rejects with SessionMissing', async () => {
    const { api, redirects } = setup(() => json({ code: 'SessionMissing', message: 'no dt_token cookie' }, 401));
    await expect(api.getToday()).rejects.toMatchObject({ code: 'SessionMissing' });
    expect(redirects).toEqual(['/v1/login?return=%2Fexam%2Fmock%3Fx%3D1']);
  });
  it('a current path outside /exam/ falls back to /exam/ (E9)', async () => {
    const redirects: string[] = [];
    const api = new HttpExamApi({ fetchImpl: (async () => json({}, 401)) as never, redirect: (u) => redirects.push(u), currentPath: () => 'https://evil.example/x', storage: null, onOnline: () => undefined });
    await api.getToday().catch(() => undefined);
    expect(redirects).toEqual(['/v1/login?return=%2Fexam%2F']);
  });
  it('network failure and proxy 502/503 are "down" with the DR8 copy', async () => {
    const net = new HttpExamApi({ fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as never, storage: null, onOnline: () => undefined });
    await expect(net.getToday()).rejects.toMatchObject({ code: 'Offline', down: true, message: DOWN_COPY });
    expect(DOWN_COPY).toBe("The Exam page is down for now. Answers you already saved are safe. DeepTutor's Practice and Tutor still work.");
    const proxy = setup(() => new Response('<html>down</html>', { status: 503 }));
    await expect(proxy.api.getToday()).rejects.toMatchObject({ code: 'Down', down: true });
    const brain503 = setup(() => json({ code: 'RenderFailed', message: 'x' }, 503));
    await expect(brain503.api.getItem('p1')).rejects.toMatchObject({ code: 'RenderFailed', down: false }); // a brain answer is not an outage
  });
  it('E10: a different X-Vidhya-Build fires the mismatch listener once; the same build or a dev build does not', async () => {
    const s = setup(() => json([], 200, { 'x-vidhya-build': 'b2' }), { buildId: 'b1' });
    const l = vi.fn();
    s.api.onBuildMismatch(l);
    await s.api.listTopics(); await s.api.listTopics();
    expect(l).toHaveBeenCalledTimes(1);
    expect(l).toHaveBeenCalledWith('b2');
    const same = setup(() => json([], 200, { 'x-vidhya-build': 'b1' }), { buildId: 'b1' });
    const l2 = vi.fn(); same.api.onBuildMismatch(l2); await same.api.listTopics();
    const dev = setup(() => json([], 200, { 'x-vidhya-build': 'zzz' }), { buildId: 'dev' });
    const l3 = vi.fn(); dev.api.onBuildMismatch(l3); await dev.api.listTopics();
    expect(l2).not.toHaveBeenCalled();
    expect(l3).not.toHaveBeenCalled();
  });
});

describe('HttpExamApi practice checks and the offline queue (DR5, E7)', () => {
  const result = { itemId: 'p1', outcome: 'correct', yours: 'B', key: 'B', reason: 'r', scored: 1, week: null, verification: { state: 'rechecking' } };

  it('sends the answer with an idempotency key and the time since the item was served', async () => {
    let t = 1000;
    const calls: Call[] = [];
    const api = new HttpExamApi({
      fetchImpl: (async (u: string, i: RequestInit) => { calls.push({ url: u, init: i }); return u.includes('/check') ? json({ status: 'checked', result }) : json({ id: 'p1' }); }) as never,
      now: () => t, storage: null, onOnline: () => undefined,
    });
    await api.getItem('p1');
    t = 8500;
    const out = await api.checkAnswer('p1', { kind: 'mcq', key: 'B' });
    expect(out).toEqual({ status: 'checked', result });
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body).toMatchObject({ answer: { kind: 'mcq', key: 'B' }, elapsedMs: 7500 });
    expect(typeof body.idempotencyKey).toBe('string');
  });

  it('offline: returns queued, holds the answer tagged with the owner, and flushes the same key when the network returns', async () => {
    let online = true;
    const checkBodies: any[] = [];
    const s = setup((c) => {
      if (c.url === '/v1/session') return json(session);
      if (!online) throw new TypeError('offline');
      if (c.url.endsWith('/check')) { checkBodies.push(JSON.parse(String(c.init.body))); return json({ status: 'checked', result }); }
      return json({});
    });
    await s.api.init();
    online = false;
    const out = await s.api.checkAnswer('p1', { kind: 'mcq', key: 'B' });
    expect(out).toEqual({ status: 'queued' });
    expect(s.api.waiting()).toBe(1);
    expect(JSON.parse(s.store[QUEUE_KEY]!)[0]).toMatchObject({ kind: 'check', owner: 'stu-1', itemId: 'p1' });
    const got: unknown[] = [];
    s.api.onQueuedResult((r) => got.push(r));
    await s.api.flush(); // still offline: nothing lost
    expect(s.api.waiting()).toBe(1);
    online = true;
    await s.api.flush();
    expect(got).toEqual([result]);
    expect(s.api.waiting()).toBe(0);
    expect(checkBodies).toHaveLength(1);
  });

  it('E7: entries from another login are held, not sent and not deleted', async () => {
    const store = { [QUEUE_KEY]: JSON.stringify([{ kind: 'check', owner: 'someone-else', itemId: 'p1', answer: { kind: 'mcq', key: 'A' }, key: 'k1' }]) };
    const s = setup((c) => (c.url === '/v1/session' ? json(session) : json({ status: 'checked', result })), { storage: store });
    await s.api.init();
    await s.api.flush();
    expect(s.calls.map((c) => c.url)).toEqual(['/v1/session']);
    expect(s.api.heldForOthers()).toBe(1);
    expect(s.api.waiting()).toBe(0);
    expect(JSON.parse(store[QUEUE_KEY]!)).toHaveLength(1);
  });
});

describe('HttpExamApi mock answers', () => {
  it('sends one answer per call with owner, flag and idempotency key', async () => {
    const s = setup((c) => (c.url === '/v1/session' ? json(session) : json({ status: 'saved' })));
    await s.api.answerMock('7', 'm1', { kind: 'nat', raw: '2.5' }, true);
    const post = s.calls.find((c) => c.url === '/v1/mock/attempts/7/answers')!;
    expect(JSON.parse(String(post.init.body))).toMatchObject({ itemId: 'm1', answer: { kind: 'nat', raw: '2.5' }, flagged: true, queueOwner: 'stu-1' });
  });
  it('offline: resolves (saved on the device), counts as waiting, then sends in order through autosave', async () => {
    let online = true;
    const autosaves: any[] = [];
    const s = setup((c) => {
      if (c.url === '/v1/session') return json(session);
      if (!online) throw new TypeError('offline');
      if (c.url.endsWith('/autosave')) { const b = JSON.parse(String(c.init.body)); autosaves.push(b); return json({ results: b.entries.map((e: any) => ({ idempotencyKey: e.idempotencyKey, status: 'saved' })) }); }
      return json({ status: 'saved' });
    });
    await s.api.init();
    const seen: number[] = [];
    s.api.onWaiting((n) => seen.push(n));
    online = false;
    await s.api.answerMock('7', 'm1', { kind: 'mcq', key: 'A' }, false);
    await s.api.answerMock('7', 'm1', { kind: 'mcq', key: 'B' }, false); // behind the first, so order is kept
    expect(s.api.waiting()).toBe(2);
    online = true;
    await s.api.flush();
    expect(s.api.waiting()).toBe(0);
    expect(autosaves).toHaveLength(1);
    expect(autosaves[0].entries.map((e: any) => e.answer.key)).toEqual(['A', 'B']);
    expect(seen).toContain(2);
    expect(seen[seen.length - 1]).toBe(0);
  });
  it('a definite refusal drops the entry instead of retrying forever', async () => {
    let online = false;
    const s = setup((c) => {
      if (c.url === '/v1/session') return json(session);
      if (!online) throw new TypeError('offline');
      return json({ code: 'MockAttemptClosed', message: 'closed' }, 409);
    });
    await s.api.init();
    await s.api.answerMock('7', 'm1', null, false);
    online = true;
    await s.api.flush();
    expect(s.api.waiting()).toBe(0);
  });
  it('submit flushes waiting answers first', async () => {
    const order: string[] = [];
    let online = false;
    const s = setup((c) => {
      if (c.url === '/v1/session') return json(session);
      if (!online) throw new TypeError('offline');
      order.push(c.url);
      return c.url.endsWith('/autosave') ? json({ results: [] }) : json({ attemptId: '7', mode: 'scored', autoClosed: false });
    });
    await s.api.init();
    await s.api.answerMock('7', 'm1', null, false);
    online = true;
    await s.api.submitMock('7');
    expect(order).toEqual(['/v1/mock/attempts/7/autosave', '/v1/mock/attempts/7/submit']);
  });
});
