/** Wave 3a gap fixes: report-then-dispute (migration 005), the mock tier flag, the 15-item floor, the DR7 exception. */
import { describe, it, expect } from 'vitest';
import { startAttempt, registerForm, saveAnswer, submit, MIN_FORM_ITEMS, savedAnswerState } from '../attempts.js';
import { reportDuringMock } from '../report.js';
import { fileDispute, hiddenItemIdsFor, queueForReview } from '../../disputes/disputes.js';
import { openStore } from '../../store/db.js';
import { hashId, upsertStudent } from '../../registry/registry.js';
import { isBrainError } from '../../errors.js';
import { ITEMS, TIMING, TIERS, world, T0, S1, S2, at, min, meta, mcq } from './fixtures.js';
import { freeze } from '../items.js';

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return isBrainError(e) ? e.code : 'other'; }
  return 'none';
};

describe('gap (a): a mock-time report does not block the same student\'s later counted dispute', () => {
  it('queue report first, counted dispute after: both rows exist, the item is hidden for the reporter', () => {
    const { db, ctx, items } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    reportDuringMock(db, S1, a.attempt_id, 'm2', 'key looks off', at(T0, min(1)));
    const fp = freeze(items.get('m2')!).fingerprint;
    const r = fileDispute(db, { item_id: 'm2', fingerprint: fp, student_hash: S1, channel: 'exam' }, at(T0, min(2)));
    expect(r.outcome).toBe('hidden_for_reporter');
    expect(hiddenItemIdsFor(db, S1).has('m2')).toBe(true);
    const rows = db.prepare('SELECT counted, state FROM disputes WHERE student_hash = ? ORDER BY id').all(S1);
    expect(rows).toEqual([{ counted: 0, state: 'giri_queue' }, { counted: 1, state: 'hidden_for_reporter' }]);
  });
  it('a second counted dispute and a second queue report are still duplicates', () => {
    const { db, items } = world();
    const fp = freeze(items.get('m2')!).fingerprint;
    expect(fileDispute(db, { item_id: 'm2', fingerprint: fp, student_hash: S1, channel: 'exam' }, T0).outcome).toBe('hidden_for_reporter');
    expect(fileDispute(db, { item_id: 'm2', fingerprint: fp, student_hash: S1, channel: 'exam' }, T0).outcome).toBe('duplicate');
    expect(queueForReview(db, { item_id: 'm3', fingerprint: fp, student_hash: S1 }, T0)).toBe('queued');
    expect(queueForReview(db, { item_id: 'm3', fingerprint: fp, student_hash: S1 }, T0)).toBe('duplicate');
  });
  it('the queue report alone never counts toward quorum', () => {
    const { db, ctx, items } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    reportDuringMock(db, S1, a.attempt_id, 'm2', undefined, T0);
    const fp = freeze(items.get('m2')!).fingerprint;
    // S2 files a counted dispute: only one counted reporter, so no quarantine
    expect(fileDispute(db, { item_id: 'm2', fingerprint: fp, student_hash: S2, channel: 'exam' }, T0).outcome).toBe('hidden_for_reporter');
  });
  it('an anonymous MCP queue report is allowed (student null) and is not counted', () => {
    const { db, items } = world();
    const fp = freeze(items.get('m2')!).fingerprint;
    expect(queueForReview(db, { item_id: 'm2', fingerprint: fp, student_hash: null, note: 'x' }, T0)).toBe('queued');
    expect(db.prepare('SELECT channel, counted, state, student_hash FROM disputes').get()).toEqual({ channel: 'mcp', counted: 0, state: 'giri_queue', student_hash: null });
  });
  it('migration 005 lands on a database that already holds an old-style dispute row', async () => {
    const { applyPending } = await import('../../store/migrate.js');
    const { MIGRATIONS } = await import('../../store/migrations.js');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    applyPending(db, MIGRATIONS.filter((m) => m.version <= 4));
    db.prepare("INSERT INTO disputes (item_id, fingerprint, student_hash, channel, day, counted, state, created_at) VALUES ('i','f','s','exam','2026-12-13',1,'hidden_for_reporter','t')").run();
    applyPending(db, MIGRATIONS);
    expect(db.prepare('SELECT COUNT(*) AS n FROM disputes').get()).toEqual({ n: 1 });
  });
});

describe('gap (b): the mock tier flag', () => {
  it('a tier with mock off cannot start a mock, a tier with mock on can; the refusal is FeatureNotEnabled', () => {
    const { db, ctx } = world();
    const free = hashId('syn-free', 'salt');
    upsertStudent(db, { student_hash: free, dt_user_hash: hashId('syn-dt-free', 'salt'), tier: 'free', entitled_until: '2026-12-31' }, T0);
    expect(code(() => startAttempt(db, ctx, free, 'f1', T0))).toBe('FeatureNotEnabled');
    expect(startAttempt(db, ctx, S1, 'f1', T0).mode).toBe('scored');
  });
  it('an unknown tier is refused loudly', () => {
    const { db, ctx } = world();
    const odd = hashId('syn-odd', 'salt');
    upsertStudent(db, { student_hash: odd, dt_user_hash: hashId('syn-dt-odd', 'salt'), tier: 'nope', entitled_until: '2026-12-31' }, T0);
    expect(code(() => startAttempt(db, ctx, odd, 'f1', T0))).toBe('UnknownTier');
  });
});

describe('gap (d): started-before-expiry attempts can be finished; new ones are refused with AccessEnded', () => {
  it('resume, save and submit work for an attempt started while entitled; a fresh start with the same expiry cannot start', () => {
    const { db, ctx } = world({ entitled_until: '2026-12-13' });
    const a = startAttempt(db, ctx, S1, 'f1', at(T0, min(1)));
    const later = new Date('2026-12-14T09:05:00Z'); // the day after access ended
    const inWindow = at(T0, min(20)); // still inside the attempt's window
    expect(startAttempt(db, ctx, S1, 'f1', inWindow).resumed).toBe(true);
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, inWindow)).status).toBe('saved');
    expect(submit(db, ctx, S1, a.attempt_id, inWindow).mode).toBe('scored');
    expect(code(() => startAttempt(db, ctx, S2, 'f1', later))).toBe('AccessEnded');
  });
});

describe('gap (c): at least 15 items per form', () => {
  it('14 items are refused, 15 are accepted', () => {
    const db = openStore(':memory:');
    expect(MIN_FORM_ITEMS).toBe(15);
    expect(code(() => registerForm(db, { form_version: 'small', items: ITEMS.slice(0, 14), timing: TIMING }, T0))).toBe('InvalidMockForm');
    expect(code(() => registerForm(db, { form_version: 'ok', items: ITEMS.slice(0, 15), timing: TIMING }, T0))).toBe('none');
  });
});

describe('flag for later', () => {
  it('is stored with the answer and the latest entry wins', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), { ...meta(S1, at(T0, min(1))), flagged: true });
    expect(savedAnswerState(db, S1, a.attempt_id)).toEqual([{ item_id: 'm1', response: mcq(1), flagged: true }]);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(2), { ...meta(S1, at(T0, min(2))), flagged: false });
    expect(savedAnswerState(db, S1, a.attempt_id)).toEqual([{ item_id: 'm1', response: mcq(2), flagged: false }]);
  });
});
