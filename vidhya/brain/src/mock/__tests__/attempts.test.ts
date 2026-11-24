import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../../store/db.js';
import { isBrainError } from '../../errors.js';
import { upsertStudent, hashId } from '../../registry/registry.js';
import { adminQuarantine } from '../../disputes/disputes.js';
import { fingerprint } from '../../item/schema.js';
import { startAttempt, saveAnswer, submit, attemptItems, savedAnswers, registerForm } from '../attempts.js';
import { resultView } from '../view.js';
import { formMinutes } from '../timing.js';
import { world, T0, min, at, meta, mcq, msq, nat, S1, S2, FORM_MINUTES, ITEMS, TIMING } from './fixtures.js';

const code = (fn: () => unknown, c: string) => {
  try { fn(); } catch (e) { expect(isBrainError(e, c as never), String(e)).toBe(true); return; }
  expect.unreachable(`expected ${c}`);
};

describe('form + start', () => {
  it('minutes come from the exam timing and the form marks, rounded up', () => {
    expect(formMinutes(TIMING, 6)).toBe(11);
    expect(formMinutes({ total_minutes: 120, total_marks: 60 }, 10)).toBe(20);
    const { db } = world();
    expect(db.prepare('SELECT minutes FROM mock_forms').get()).toEqual({ minutes: FORM_MINUTES });
  });
  it('a different pace gives a different deadline (nothing hard-coded)', () => {
    const { db, ctx } = world();
    registerForm(db, { form_version: 'f2', items: ITEMS, timing: { total_minutes: 60, total_marks: 60 } }, T0);
    const a = startAttempt(db, ctx, S1, 'f2', T0);
    expect(Date.parse(a.deadline_at) - T0.getTime()).toBe(min(6));
  });
  it('starts one in-progress scored attempt with a server deadline = start + form minutes', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    expect(a).toMatchObject({ mode: 'scored', finished: false, resumed: false, minutes: FORM_MINUTES });
    expect(a.deadline_at).toBe(at(T0, min(FORM_MINUTES)).toISOString());
    expect(db.prepare("SELECT state FROM mocks WHERE id = ?").get(a.attempt_id)).toEqual({ state: 'in_progress' });
  });
  it('items are frozen at start: a later change to the pack does not change the attempt', () => {
    const { db, ctx, items } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    expect(attemptItems(db, ctx, S1, a.attempt_id).map((i) => i.item_id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    items.delete('m4');
    items.set('extra', { ...ITEMS[0]!, id: 'extra' });
    const v = attemptItems(db, ctx, S1, a.attempt_id);
    expect(v.map((i) => i.item_id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(v[3]).toMatchObject({ unavailable: true });
  });
  it('registerForm refuses non-mock pool items and a changed form under the same version', () => {
    const { db } = world();
    code(() => registerForm(db, { form_version: 'g', items: [{ ...ITEMS[0]!, pool: 'practice' }], timing: TIMING }, T0), 'InvalidMockForm');
    code(() => registerForm(db, { form_version: 'f1', items: ITEMS.slice(0, 2), timing: TIMING }, T0), 'InvalidMockForm');
    registerForm(db, { form_version: 'f1', items: ITEMS, timing: TIMING, planned_close: '2026-12-20' }, T0); // identical: idempotent
  });
  it('an unknown form is a named error', () => {
    const { db, ctx } = world();
    code(() => startAttempt(db, ctx, S1, 'nope', T0), 'MockFormUnknown');
  });
  it('starting again while running resumes the same attempt', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    const b = startAttempt(db, ctx, S1, 'f1', at(T0, min(3)));
    expect(b).toMatchObject({ attempt_id: a.attempt_id, resumed: true, deadline_at: a.deadline_at });
  });
  it('one scored attempt per student per form; a later attempt is practice (MockAlreadyScored) and out of the range', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    submit(db, ctx, S1, a.attempt_id, at(T0, min(5)));
    const b = startAttempt(db, ctx, S1, 'f1', at(T0, min(6)));
    expect(b).toMatchObject({ mode: 'practice', notice: 'MockAlreadyScored', resumed: false });
    expect(db.prepare("SELECT state, COUNT(*) n FROM mocks WHERE student_hash = ? GROUP BY state ORDER BY state").all(S1)).toEqual([
      { state: 'practice_only', n: 1 }, { state: 'scored', n: 1 },
    ]);
  });
  it('the database itself refuses a second scored row', () => {
    const { db, ctx } = world();
    startAttempt(db, ctx, S1, 'f1', T0);
    expect(() =>
      db.prepare("INSERT INTO mocks (student_hash, form_version, state, started_at, deadline_at, minutes, items_json) VALUES (?, 'f1', 'in_progress', 'x', 'y', 1, '[]')").run(S1),
    ).toThrow(/UNIQUE/);
  });
  it('two students are independent', () => {
    const { db, ctx } = world();
    expect(startAttempt(db, ctx, S1, 'f1', T0).mode).toBe('scored');
    expect(startAttempt(db, ctx, S2, 'f1', T0).mode).toBe('scored');
  });
});

describe('DR7: entitlement', () => {
  it('an expired student cannot START a mock', () => {
    const { db, ctx } = world({ entitled_until: '2026-12-12' });
    code(() => startAttempt(db, ctx, S1, 'f1', T0), 'AccessEnded');
    expect(db.prepare('SELECT COUNT(*) n FROM mocks').get()).toEqual({ n: 0 });
  });
  it('a student with no entitled_until cannot start either', () => {
    const { db, ctx } = world({ entitled_until: null });
    code(() => startAttempt(db, ctx, S1, 'f1', T0), 'AccessEnded');
  });
  it('an attempt started while entitled can still be answered, resumed and submitted after access ends', () => {
    const { db, ctx } = world({ entitled_until: '2026-12-13' });
    const a = startAttempt(db, ctx, S1, 'f1', at(T0, min(60 * 14 + 55))); // 23:55 UTC on the last entitled day
    expect(a.mode).toBe('scored');
    // the deadline crosses midnight UTC: access has "ended" by the calendar
    const t = at(T0, min(60 * 14 + 55 + 8));
    expect(new Date(t).toISOString().slice(0, 10)).toBe('2026-12-14');
    expect(startAttempt(db, ctx, S1, 'f1', t)).toMatchObject({ attempt_id: a.attempt_id, resumed: true });
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, t)).status).toBe('saved');
    expect(submit(db, ctx, S1, a.attempt_id, t).auto_closed).toBe(false);
  });
});

describe('R21 autosave', () => {
  it('persists on entry, idempotent on (attempt, item, key)', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    const m = meta(S1, at(T0, min(1)), at(T0, min(1)), 'dup');
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), m).status).toBe('saved');
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), m).status).toBe('duplicate');
    expect(db.prepare('SELECT COUNT(*) n FROM mock_answers').get()).toEqual({ n: 1 });
    // the same key on another item is a different entry
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(2), m).status).toBe('saved');
  });
  it('the latest entry per item wins, even when it arrives out of order', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(3)), at(T0, min(2))));
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(0), meta(S1, at(T0, min(4)), at(T0, min(1)))); // older entry, arrives later
    expect(savedAnswers(db, S1, a.attempt_id)).toEqual([{ item_id: 'm1', response: mcq(1) }]);
  });
  it('answers survive a brain restart (a file database reopened)', () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'mock-')), 'brain.db');
    const w = world();
    const db1 = openStore(f);
    for (const [n, s] of [[1, S1]] as const) upsertStudent(db1, { student_hash: s, dt_user_hash: hashId(`syn-dt-${n}`, 'salt'), tier: 'pilot', entitled_until: '2026-12-31' }, T0);
    registerForm(db1, { form_version: 'f1', items: ITEMS, timing: TIMING }, T0);
    const a = startAttempt(db1, w.ctx, S1, 'f1', T0);
    saveAnswer(db1, w.ctx, S1, a.attempt_id, 'm4', nat(2), meta(S1, at(T0, min(1))));
    db1.close();
    const db2 = openStore(f);
    expect(savedAnswers(db2, S1, a.attempt_id)).toEqual([{ item_id: 'm4', response: nat(2) }]);
    expect(startAttempt(db2, w.ctx, S1, 'f1', at(T0, min(2)))).toMatchObject({ resumed: true, attempt_id: a.attempt_id });
  });
  it('a bad pick is refused by the scorer and nothing is stored (R10)', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(9), meta(S1, T0)), 'InvalidResponse');
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm1', nat(1), meta(S1, T0)), 'InvalidResponse');
    expect(db.prepare('SELECT COUNT(*) n FROM mock_answers').get()).toEqual({ n: 0 });
  });
  it('an item that is not in the attempt is refused', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'zzz', mcq(0), meta(S1, T0)), 'MockItemNotInForm');
  });
  it('a duplicate key is required', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(0), { ...meta(S1, T0), idempotencyKey: '' }), 'InvalidMockRequest');
  });
});

describe('E3 + E6: the deadline and the 2-minute sync window', () => {
  const deadline = at(T0, min(FORM_MINUTES));
  it('an answer at deadline + 90 s counts and is flagged late_sync', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(deadline, 90_000), at(deadline, -5_000)));
    expect(db.prepare('SELECT late_sync FROM mock_answers').get()).toEqual({ late_sync: 1 });
    const r = submit(db, ctx, S1, a.attempt_id, at(deadline, 100_000));
    expect(r.auto_closed).toBe(false);
    expect(resultView(db, ctx, S1, a.attempt_id, at(deadline, 100_000))).toMatchObject({ score: 1 });
  });
  it('an answer received before the deadline is not flagged', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(deadline, -1000)));
    expect(db.prepare('SELECT late_sync FROM mock_answers').get()).toEqual({ late_sync: 0 });
  });
  it('an answer at deadline + 150 s is refused (MockLateSubmit) and the attempt auto-closes on what was saved', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(2))));
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(2), meta(S1, at(deadline, 150_000), at(deadline, -1000))), 'MockLateSubmit');
    expect(db.prepare('SELECT COUNT(*) n FROM mock_answers').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT state, submit_reason, submitted_at FROM mocks').get()).toEqual({
      state: 'scored', submit_reason: 'auto', submitted_at: at(deadline, 120_000).toISOString(),
    });
  });
  it('the window is half-open: exactly deadline + 2 min is refused, 1 ms before counts', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(deadline, 119_999), at(deadline, -1))).status).toBe('saved');
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(2), meta(S1, at(deadline, 120_000), at(deadline, -1))), 'MockLateSubmit');
  });
  it('E6: an answer ENTERED after the deadline is refused even inside the window', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(deadline, 30_000), at(deadline, 10_000))), 'MockLateSubmit');
    expect(db.prepare('SELECT COUNT(*) n FROM mock_answers').get()).toEqual({ n: 0 });
    // entered exactly at the deadline is the last allowed instant
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(deadline, 30_000), deadline)).status).toBe('saved');
  });
  it('an answer after a manual submit is refused as MockAttemptClosed', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    submit(db, ctx, S1, a.attempt_id, at(T0, min(2)));
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(3)))), 'MockAttemptClosed');
  });
});

describe('E7: ownership', () => {
  it("refuses an answer on another student's attempt", () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => saveAnswer(db, ctx, S2, a.attempt_id, 'm1', mcq(1), meta(S2, T0)), 'AttemptNotOwned');
    expect(db.prepare('SELECT COUNT(*) n FROM mock_answers').get()).toEqual({ n: 0 });
  });
  it("refuses a queued entry tagged with another student's queue (shared phone)", () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), { ...meta(S1, T0), queueOwner: S2 }), 'AttemptNotOwned');
    expect(db.prepare('SELECT COUNT(*) n FROM mock_answers').get()).toEqual({ n: 0 });
  });
  it('an unknown attempt id looks the same as someone else’s (no probing)', () => {
    const { db, ctx } = world();
    code(() => saveAnswer(db, ctx, S1, 9999, 'm1', mcq(1), meta(S1, T0)), 'AttemptNotOwned');
  });
  it('every read and write on an attempt checks the owner', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => attemptItems(db, ctx, S2, a.attempt_id), 'AttemptNotOwned');
    code(() => savedAnswers(db, S2, a.attempt_id), 'AttemptNotOwned');
    code(() => submit(db, ctx, S2, a.attempt_id, T0), 'AttemptNotOwned');
    code(() => resultView(db, ctx, S2, a.attempt_id, T0), 'AttemptNotOwned');
  });
});

describe('submit + scoring', () => {
  const sit = () => {
    const w = world();
    const a = startAttempt(w.db, w.ctx, S1, 'f1', T0);
    return { ...w, a };
  };
  it('scores with the exam marking: right, wrong with negative marks, skipped', () => {
    const { db, ctx, a } = sit();
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, T0)); // +1
    saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(0), meta(S1, T0)); // wrong 2-mark: -2/3
    saveAnswer(db, ctx, S1, a.attempt_id, 'm3', msq([0, 3]), meta(S1, T0)); // +2
    // m4 unanswered -> skipped
    submit(db, ctx, S1, a.attempt_id, at(T0, min(5)));
    expect(resultView(db, ctx, S1, a.attempt_id, at(T0, min(6)))).toMatchObject({
      score: 2.333333, max_marks: 6, counts: { right: 2, wrong: 1, skipped: 1 },
    });
    expect(db.prepare("SELECT state, score FROM mocks").get()).toEqual({ state: 'scored', score: 2.333333 });
  });
  it('NAT inside the range counts', () => {
    const { db, ctx, a } = sit();
    saveAnswer(db, ctx, S1, a.attempt_id, 'm4', nat(2.05), meta(S1, T0));
    submit(db, ctx, S1, a.attempt_id, at(T0, min(1)));
    expect(resultView(db, ctx, S1, a.attempt_id, at(T0, min(1)))).toMatchObject({ score: 1, counts: { right: 1, wrong: 0, skipped: 3 } });
  });
  it('submit is idempotent and returns the first result', () => {
    const { db, ctx, a } = sit();
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, T0));
    const t = at(T0, min(2));
    submit(db, ctx, S1, a.attempt_id, t);
    expect(submit(db, ctx, S1, a.attempt_id, at(T0, min(3)))).toMatchObject({ auto_closed: false });
    expect(db.prepare('SELECT submitted_at FROM mocks').get()).toEqual({ submitted_at: t.toISOString() });
  });
  it('auto-closes at deadline + 2 min with no submit, on the saved answers', () => {
    const { db, ctx, a } = sit();
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, T0));
    const later = at(T0, min(FORM_MINUTES + 30));
    expect(submit(db, ctx, S1, a.attempt_id, later)).toMatchObject({ auto_closed: true });
    expect(resultView(db, ctx, S1, a.attempt_id, later)).toMatchObject({ score: 1 });
  });
  it('a result needs a finished attempt', () => {
    const { db, ctx, a } = sit();
    code(() => resultView(db, ctx, S1, a.attempt_id, at(T0, min(1))), 'MockNotSubmitted');
  });
  it('an item withdrawn mid-mock stays in the attempt and counts on neither side (S4 Schedule C)', () => {
    const { db, ctx, a, items } = sit();
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, T0));
    saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(2), meta(S1, T0)); // would be +2
    adminQuarantine(db, { item_id: 'm2', fingerprint: fingerprint(items.get('m2')!), actor: 'admin-1', reason: 'disputed' }, at(T0, min(4)));
    expect(attemptItems(db, ctx, S1, a.attempt_id).map((i) => i.item_id)).toContain('m2'); // still served
    saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(2), meta(S1, at(T0, min(5)))); // still accepted
    submit(db, ctx, S1, a.attempt_id, at(T0, min(6)));
    expect(resultView(db, ctx, S1, a.attempt_id, at(T0, min(6)))).toMatchObject({ score: 1, max_marks: 4, counts: { right: 1, wrong: 0, skipped: 2 } });
  });
  it('an errata that changed the grading is withdrawn, not silently re-graded', () => {
    const { db, ctx, a, items } = sit();
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, T0));
    items.set('m1', { ...items.get('m1')!, key: 3 });
    submit(db, ctx, S1, a.attempt_id, at(T0, min(1)));
    expect(resultView(db, ctx, S1, a.attempt_id, at(T0, min(1)))).toMatchObject({ score: 0, max_marks: 5 });
  });
});
