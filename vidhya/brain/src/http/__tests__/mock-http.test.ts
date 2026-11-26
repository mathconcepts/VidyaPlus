import { describe, it, expect, afterEach } from 'vitest';
import { harness, studentHash, mcqAns, natAns, T0, at, min, MOCK_SOLUTION, type Harness } from './harness.js';
import { leaks } from './leaks.js';
import { closeMock } from '../../mock/close.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

const SENTINELS = [MOCK_SOLUTION, 'topic-secret', 'concept-secret', 'RECEIPT'];
const entry = (itemId: string, answer: unknown, key: string, enteredAt: Date, owner = studentHash('s1'), flagged = false) =>
  ({ itemId, answer, flagged, idempotencyKey: key, enteredAt: enteredAt.toISOString(), queueOwner: owner });

describe('the mock over HTTP, and the no-leak contract extended to every response before close', () => {
  it('a full sitting returns nothing key-shaped on any route, success or error', async () => {
    h = await harness();
    const bodies: Record<string, unknown> = {};
    const texts: string[] = [];
    const note = (name: string, r: { json: unknown; text: string }) => { bodies[name] = r.json; texts.push(r.text); return r; };

    note('brief', await h.call('GET', '/v1/mock'));
    const start = note('start', await h.call('POST', '/v1/mock/attempts', { body: {} }));
    expect(start.status).toBe(200);
    const id = start.json.attemptId as string;
    // the exact item shape: stem and options only (an option letter is called `key` in the contract)
    expect(Object.keys(start.json.items[0]).sort()).toEqual(['id', 'kind', 'marks', 'negative', 'options', 'stemHtml']);
    expect(Object.keys(start.json.items[2]).sort()).toEqual(['id', 'kind', 'marks', 'negative', 'stemHtml']); // the NAT item
    expect(start.json.items).toHaveLength(15);
    expect(Object.keys(start.json).sort()).toEqual(['attemptId', 'deadlineMs', 'items', 'saved', 'serverNowMs']);

    h.clock.now = at(T0, min(1));
    note('answer', await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('B'), 'k1', h.clock.now, studentHash('s1'), true) }));
    note('answer:nat', await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m3', natAns('2.0'), 'k2', h.clock.now) }));
    note('answer:dup', await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('B'), 'k1', h.clock.now) }));
    note('autosave', await h.call('POST', `/v1/mock/attempts/${id}/autosave`, { body: { entries: [entry('m2', mcqAns('A'), 'k3', h.clock.now), entry('m2', mcqAns('A'), 'k3', h.clock.now), entry('m2', mcqAns('A'), 'k4', h.clock.now, 'someone-else')] } }));
    note('state', await h.call('GET', `/v1/mock/attempts/${id}`));
    note('report', await h.call('POST', '/v1/report', { body: { itemId: 'm2', note: 'check the key', context: 'mock' } }));
    // refusals
    note('err:badanswer', await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('Z'), 'k5', h.clock.now) }));
    note('err:notinform', await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('p1', mcqAns('A'), 'k6', h.clock.now) }));
    note('err:other', await h.call('GET', `/v1/mock/attempts/${id}`, { as: 's2' }));
    note('err:review-early', await h.call('GET', '/v1/mock/review'));
    note('err:result-early', await h.call('GET', `/v1/mock/attempts/${id}/result`));
    note('submit', await h.call('POST', `/v1/mock/attempts/${id}/submit`, { body: {} }));
    note('result', await h.call('GET', `/v1/mock/attempts/${id}/result`));
    note('err:late-answer', await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('B'), 'k7', h.clock.now) }));
    note('brief:after', await h.call('GET', '/v1/mock'));

    expect(leaks(bodies, SENTINELS)).toEqual([]);
    for (const t of texts) for (const s of SENTINELS) expect(t).not.toContain(s);
    expect(bodies['err:other']).toMatchObject({ code: 'AttemptNotOwned' });
    expect(bodies['err:review-early']).toMatchObject({ code: 'MockNotClosed' });
    expect(bodies['err:result-early']).toBeDefined();
    expect(Object.keys(bodies['result'] as object).sort()).toEqual(['outOf', 'right', 'score', 'skipped', 'submittedOn', 'unlockOn', 'wrong']);
    expect(bodies['result']).toMatchObject({ score: 1.666667, outOf: 15, right: 2, wrong: 1, skipped: 12, unlockOn: 'Sun 20 Dec', submittedOn: 'Sun 13 Dec' });
  });

  it('saved state carries the flag and the answer back (resume after an outage)', async () => {
    h = await harness();
    const id = (await h.call('POST', '/v1/mock/attempts', { body: {} })).json.attemptId as string;
    h.clock.now = at(T0, min(2));
    await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('C'), 'k1', h.clock.now, studentHash('s1'), true) });
    await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m3', natAns('2'), 'k2', h.clock.now) });
    await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m4', null, 'k3', h.clock.now) });
    const resumed = (await h.call('POST', '/v1/mock/attempts', { body: {} })).json;
    expect(resumed.attemptId).toBe(id);
    expect(resumed.saved).toEqual({ m1: { answer: mcqAns('C'), flagged: true }, m3: { answer: natAns('2'), flagged: false }, m4: { answer: null, flagged: false } });
    expect(resumed.deadlineMs - resumed.serverNowMs).toBe(min(27) - min(2));
  });

  it('E3 over HTTP: an answer 90 s after the deadline counts (late_sync), one at 150 s is refused', async () => {
    h = await harness();
    const id = (await h.call('POST', '/v1/mock/attempts', { body: {} })).json.attemptId as string;
    h.clock.now = at(T0, min(27) + 90_000);
    const ok = await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('B'), 'k1', at(T0, min(26))) });
    expect(ok.json).toEqual({ status: 'saved' });
    expect(h.db.prepare('SELECT late_sync FROM mock_answers').get()).toEqual({ late_sync: 1 });
    h.clock.now = at(T0, min(27) + 150_000);
    const late = await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m2', mcqAns('B'), 'k2', at(T0, min(26))) });
    expect(late.status).toBe(409);
    expect(late.json.code).toBe('MockLateSubmit');
  });

  it('E7 over HTTP: an autosave batch tagged with another login is refused per entry, the rest is saved', async () => {
    h = await harness();
    const id = (await h.call('POST', '/v1/mock/attempts', { body: {} })).json.attemptId as string;
    const r = await h.call('POST', `/v1/mock/attempts/${id}/autosave`, { body: { entries: [entry('m1', mcqAns('B'), 'a', T0), entry('m2', mcqAns('B'), 'b', T0, studentHash('s2'))] } });
    expect(r.json.results).toEqual([{ idempotencyKey: 'a', status: 'saved' }, { idempotencyKey: 'b', status: 'refused', code: 'AttemptNotOwned' }]);
    expect((await h.call('POST', `/v1/mock/attempts/${id}/answers`, { as: 's2', body: entry('m1', mcqAns('B'), 'c', T0, studentHash('s2')) })).json.code).toBe('AttemptNotOwned');
    expect((await h.call('GET', '/v1/mock/attempts/abc')).json.code).toBe('AttemptNotOwned');
  });

  it('gates: the mock flag, entitlement, the opening date and one scored attempt', async () => {
    h = await harness();
    expect((await h.call('POST', '/v1/mock/attempts', { as: 'free', body: {} })).json.code).toBe('FeatureNotEnabled');
    h.clock.now = new Date('2026-12-14T09:00:00Z');
    expect((await h.call('POST', '/v1/mock/attempts', { as: 'expired', body: {} })).json.code).toBe('AccessEnded');
    h.clock.now = new Date('2026-12-12T09:00:00Z');
    expect((await h.call('POST', '/v1/mock/attempts', { body: {} })).status).toBe(409); // before the opening date
    expect((await h.call('GET', '/v1/mock')).json.phase).toBe('before-open');
    h.clock.now = T0;
    const a = (await h.call('POST', '/v1/mock/attempts', { body: {} })).json.attemptId;
    await h.call('POST', `/v1/mock/attempts/${a}/submit`, { body: {} });
    const b = await h.call('POST', '/v1/mock/attempts', { body: {} });
    expect(b.json.attemptId).not.toBe(a); // a second attempt is practice
    expect(h.db.prepare("SELECT state FROM mocks ORDER BY id").all()).toEqual([{ state: 'scored' }, { state: 'practice_only' }]);
    expect((await h.call('GET', '/v1/mock')).json).toMatchObject({ phase: 'open', taken: 'submitted', minutes: 27, questions: 15, totalMarks: 15, unlockOn: 'Sun 20 Dec' });
  });

  it('after the cohort close the review unlocks, with keys, solutions and a receipt record per item', async () => {
    h = await harness();
    const id = (await h.call('POST', '/v1/mock/attempts', { body: {} })).json.attemptId as string;
    await h.call('POST', `/v1/mock/attempts/${id}/answers`, { body: entry('m1', mcqAns('B'), 'k1', T0) });
    await h.call('POST', `/v1/mock/attempts/${id}/submit`, { body: {} });
    closeMock(h.db, h.deps.mockCtx, 'f1', 'admin-1', at(T0, min(60)));
    h.clock.now = at(T0, min(61));
    const rv = await h.call('GET', '/v1/mock/review');
    expect(rv.status).toBe(200);
    expect(rv.json).toHaveLength(15);
    expect(rv.json[0]).toMatchObject({ item: { id: 'm1', inMock: true }, result: { outcome: 'correct', key: 'B', yours: 'B' } });
    expect(rv.json[0].result.reason).toContain(MOCK_SOLUTION);
    expect(leaks(rv.json, SENTINELS).length).toBeGreaterThan(0); // the walker does see it after close, so the silence above means something
    expect((await h.call('GET', '/v1/mock')).json.phase).toBe('closed');
    expect((await h.call('GET', '/v1/mock/review', { as: 's2' })).json.code).toBe('MockNotSubmitted');
  });
});
