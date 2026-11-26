import { describe, it, expect } from 'vitest';
import { isBrainError } from '../../errors.js';
import { adminQuarantine, adminReviewQueue, fileDispute, hiddenItemIdsFor, openOverlayRows } from '../../disputes/disputes.js';
import { fingerprint } from '../../item/schema.js';
import { startAttempt, saveAnswer, submit } from '../attempts.js';
import { resultView, LABEL_PRACTICE, LABEL_SCORED, type PostCloseResult } from '../view.js';
import { closeMock, resetAttempt } from '../close.js';
import { reportDuringMock, REPORT_REPLY } from '../report.js';
import { acceptPracticeAnswer } from '../practice.js';
import { upsertStudent, hashId } from '../../registry/registry.js';
import { world, T0, min, at, meta, mcq, S1, S2, S3, FORM_MINUTES, SECRET_KEY_TEXT } from './fixtures.js';

const code = (fn: () => unknown, c: string) => {
  try { fn(); } catch (e) { expect(isBrainError(e, c as never), String(e)).toBe(true); return; }
  expect.unreachable(`expected ${c}`);
};
const deadline = at(T0, min(FORM_MINUTES));

describe('R15 / E6: closeMock', () => {
  it('refuses while any attempt still has deadline + 2 min in the future', () => {
    const { db, ctx } = world();
    startAttempt(db, ctx, S1, 'f1', T0);
    code(() => closeMock(db, ctx, 'f1', 'admin-1', at(deadline, -1000)), 'MockCloseTooEarly'); // before the deadline
    code(() => closeMock(db, ctx, 'f1', 'admin-1', at(deadline, 30_000)), 'MockCloseTooEarly'); // inside the late-sync window
    code(() => closeMock(db, ctx, 'f1', 'admin-1', at(deadline, 119_999)), 'MockCloseTooEarly');
    expect(db.prepare('SELECT closed_at FROM mock_forms').get()).toEqual({ closed_at: null });
  });
  it('closes once every window has ended, auto-closing the unsubmitted attempts', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(1))));
    const r = closeMock(db, ctx, 'f1', 'admin-1', at(deadline, 120_000));
    expect(r).toMatchObject({ auto_closed: 1, already_closed: false });
    expect(db.prepare('SELECT state, score FROM mocks').get()).toEqual({ state: 'scored', score: 1 });
    expect(db.prepare('SELECT action, actor FROM mock_audit').all()).toEqual([{ action: 'close', actor: 'admin-1' }]);
  });
  it('a submitted attempt does not block a close', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    submit(db, ctx, S1, a.attempt_id, at(T0, min(2)));
    expect(closeMock(db, ctx, 'f1', 'admin-1', at(T0, min(3))).closed_at).toBe(at(T0, min(3)).toISOString());
  });
  it('is idempotent and needs a named actor', () => {
    const { db, ctx } = world();
    code(() => closeMock(db, ctx, 'f1', '', T0), 'InvalidMockRequest');
    const first = closeMock(db, ctx, 'f1', 'admin-1', T0);
    expect(closeMock(db, ctx, 'f1', 'admin-2', at(T0, min(5)))).toMatchObject({ already_closed: true, closed_at: first.closed_at });
    expect(db.prepare('SELECT COUNT(*) n FROM mock_audit').get()).toEqual({ n: 1 });
  });
  it('an unknown form is a named error', () => {
    const { db, ctx } = world();
    code(() => closeMock(db, ctx, 'nope', 'admin-1', T0), 'MockFormUnknown');
  });
});

describe('DR11 / DR6: the result before and after close', () => {
  const sat = () => {
    const w = world();
    const a = startAttempt(w.db, w.ctx, S1, 'f1', T0);
    saveAnswer(w.db, w.ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, T0));
    saveAnswer(w.db, w.ctx, S1, a.attempt_id, 'm2', mcq(0), meta(S1, T0));
    submit(w.db, w.ctx, S1, a.attempt_id, at(T0, min(5)));
    return { ...w, a };
  };
  it('before close: only score, max, tally, label and unlock date', () => {
    const { db, ctx, a } = sat();
    const r = resultView(db, ctx, S1, a.attempt_id, at(T0, min(6)));
    expect(r).toEqual({
      revealed: false, label: LABEL_SCORED, score: 0.333333, max_marks: 17, counts: { right: 1, wrong: 1, skipped: 13 }, unlock_date: '2026-12-20',
    });
    expect(JSON.stringify(r)).not.toContain(SECRET_KEY_TEXT);
  });
  it('after close: the review with answer, key, solution and receipt per item', () => {
    const { db, ctx, a } = sat();
    closeMock(db, ctx, 'f1', 'admin-1', at(T0, min(30)));
    const r = resultView(db, ctx, S1, a.attempt_id, at(T0, min(31))) as PostCloseResult;
    expect(r).toMatchObject({ revealed: true, mode: 'scored', label: LABEL_SCORED, score: 0.333333, withdrawn_count: 0 });
    expect(r.review).toHaveLength(15);
    expect(r.review[1]).toMatchObject({ item_id: 'm2', your_answer: mcq(0), key: 2, correct: false, receipt: { verified: true } });
    expect(r.review[1]!.solution).toContain(SECRET_KEY_TEXT);
    expect(r.review[3]).toMatchObject({ item_id: 'm4', your_answer: null });
  });
  it('an item Giri voids after close leaves everyone’s score and the result says so', () => {
    const { db, ctx, a, items } = sat();
    closeMock(db, ctx, 'f1', 'admin-1', at(T0, min(30)));
    adminQuarantine(db, { item_id: 'm2', fingerprint: fingerprint(items.get('m2')!), actor: 'admin-1', reason: 'bad key' }, at(T0, min(40)));
    const r = resultView(db, ctx, S1, a.attempt_id, at(T0, min(41))) as PostCloseResult;
    expect(r).toMatchObject({ score: 1, max_marks: 15, withdrawn_count: 1, counts: { right: 1, wrong: 0, skipped: 13 } });
    expect(r.review[1]).toMatchObject({ state: 'withdrawn', marks_max: 0, marks_awarded: 0 });
  });
  it('a student who never sat it gets practice mock · unscored after close: timed, answers at the end, outside the range', () => {
    const { db, ctx } = world();
    closeMock(db, ctx, 'f1', 'admin-1', T0);
    const a = startAttempt(db, ctx, S3, 'f1', at(T0, min(60)));
    expect(a).toMatchObject({ mode: 'practice', notice: 'practice_unscored' });
    expect(Date.parse(a.deadline_at) - Date.parse(a.started_at)).toBe(min(FORM_MINUTES));
    saveAnswer(db, ctx, S3, a.attempt_id, 'm1', mcq(1), meta(S3, at(T0, min(61))));
    code(() => resultView(db, ctx, S3, a.attempt_id, at(T0, min(62))), 'MockNotSubmitted'); // answers only at the end
    submit(db, ctx, S3, a.attempt_id, at(T0, min(63)));
    const r = resultView(db, ctx, S3, a.attempt_id, at(T0, min(64))) as PostCloseResult;
    expect(r).toMatchObject({ revealed: true, mode: 'practice', label: LABEL_PRACTICE, score: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM mocks WHERE state IN ('in_progress','scored')").get()).toEqual({ n: 0 });
  });
  it('a practice attempt before close still reveals nothing', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    submit(db, ctx, S1, a.attempt_id, at(T0, min(1)));
    const b = startAttempt(db, ctx, S1, 'f1', at(T0, min(2)));
    submit(db, ctx, S1, b.attempt_id, at(T0, min(3)));
    expect(resultView(db, ctx, S1, b.attempt_id, at(T0, min(4)))).toMatchObject({ revealed: false, label: LABEL_PRACTICE });
  });
});

describe('R21: resetAttempt', () => {
  const outage = () => {
    const w = world();
    const a = startAttempt(w.db, w.ctx, S1, 'f1', T0);
    saveAnswer(w.db, w.ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(3))));
    return { ...w, a };
  };
  it('reopens an attempt the outage covered, keeps saved answers, re-issues the deadline and writes an audit row', () => {
    const { db, ctx, a } = outage();
    const later = at(T0, min(40));
    expect(submit(db, ctx, S1, a.attempt_id, later).auto_closed).toBe(true); // nobody could sync; the server closed it
    const r = resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: 'host outage 09:05-09:40', actor: 'admin-1' }, later);
    expect(r.minutes_given).toBe(28); // 31 min window minus the 3 min used when the last answer was saved
    expect(r.deadline_at).toBe(at(later, min(28)).toISOString());
    expect(db.prepare('SELECT state, submitted_at, score FROM mocks').get()).toEqual({ state: 'in_progress', submitted_at: null, score: null });
    const audit = db.prepare("SELECT action, actor, reason, student_hash FROM mock_audit WHERE action = 'reset'").get();
    expect(audit).toEqual({ action: 'reset', actor: 'admin-1', reason: 'host outage 09:05-09:40', student_hash: S1 });
    // the answer is still there and the student can go on
    expect(saveAnswer(db, ctx, S1, a.attempt_id, 'm2', mcq(2), meta(S1, at(later, min(1)))).status).toBe('saved');
    submit(db, ctx, S1, a.attempt_id, at(later, min(2)));
    expect(resultView(db, ctx, S1, a.attempt_id, at(later, min(2)))).toMatchObject({ score: 3 });
  });
  it('honours an explicit number of minutes', () => {
    const { db, ctx, a } = outage();
    submit(db, ctx, S1, a.attempt_id, at(T0, min(40)));
    expect(resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: 'r', actor: 'a', minutes: 5 }, at(T0, min(41))).minutes_given).toBe(5);
  });
  it('the audit trail is append-only', () => {
    const { db, ctx, a } = outage();
    submit(db, ctx, S1, a.attempt_id, at(T0, min(40)));
    resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: 'r', actor: 'a' }, at(T0, min(41)));
    expect(() => db.prepare('UPDATE mock_audit SET actor = ?').run('x')).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM mock_audit').run()).toThrow(/append-only/);
  });
  it('needs an actor and a reason; refuses a running attempt, a missing one and a closed form', () => {
    const { db, ctx, a } = outage();
    code(() => resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: 'r', actor: '' }, T0), 'InvalidMockRequest');
    code(() => resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: ' ', actor: 'a' }, T0), 'InvalidMockRequest');
    code(() => resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: 'r', actor: 'a' }, at(T0, min(4))), 'MockNotResettable'); // still running
    code(() => resetAttempt(db, ctx, { student: S2, form_version: 'f1', reason: 'r', actor: 'a' }, T0), 'MockNotResettable');
    submit(db, ctx, S1, a.attempt_id, at(T0, min(5)));
    closeMock(db, ctx, 'f1', 'a', at(T0, min(6)));
    code(() => resetAttempt(db, ctx, { student: S1, form_version: 'f1', reason: 'r', actor: 'a' }, at(T0, min(7))), 'MockClosed');
    expect(db.prepare("SELECT COUNT(*) n FROM mock_audit WHERE action = 'reset'").get()).toEqual({ n: 0 });
  });
});

describe('DR18: reportDuringMock', () => {
  it('goes to the review queue only: not counted, not hidden, never quarantines, even from many students', () => {
    const { db, ctx } = world();
    const ids = [S1, S2, S3].map((s) => startAttempt(db, ctx, s, 'f1', T0).attempt_id);
    const replies = [S1, S2, S3].map((s, i) => reportDuringMock(db, s, ids[i]!, 'm2', 'the key looks wrong', at(T0, min(2))));
    for (const r of replies) expect(r).toEqual({ ok: true, message: REPORT_REPLY });
    expect(openOverlayRows(db)).toEqual([]);
    expect(db.prepare("SELECT state, counted, channel FROM disputes").all()).toEqual(Array(3).fill({ state: 'giri_queue', counted: 0, channel: 'exam' }));
    expect(hiddenItemIdsFor(db, S1).size).toBe(0);
    expect(adminReviewQueue(db).map((q) => q.note)).toEqual(Array(3).fill('the key looks wrong'));
    expect(db.prepare('SELECT COUNT(*) n FROM overlay_audit').get()).toEqual({ n: 0 });
  });
  it('the reply is identical for a repeat and carries nothing key-shaped', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    const r1 = reportDuringMock(db, S1, a.attempt_id, 'm1', undefined, T0);
    const r2 = reportDuringMock(db, S1, a.attempt_id, 'm1', 'again', T0);
    expect(r2).toEqual(r1);
    expect(Object.keys(r1).sort()).toEqual(['message', 'ok']);
    expect(db.prepare('SELECT COUNT(*) n FROM disputes').get()).toEqual({ n: 1 });
  });
  it('does not feed the storm or the daily cap', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    for (const id of ['m1', 'm2', 'm3', 'm4']) reportDuringMock(db, S1, a.attempt_id, id, undefined, T0);
    // a normal dispute afterwards is still inside the cap of 3 and counts
    expect(fileDispute(db, { item_id: 'x1', fingerprint: 'f'.repeat(64), student_hash: S1, channel: 'exam' }, T0).outcome).toBe('hidden_for_reporter');
  });
  it('only the owner can report, only on items in the attempt, notes are bounded', () => {
    const { db, ctx } = world();
    const a = startAttempt(db, ctx, S1, 'f1', T0);
    code(() => reportDuringMock(db, S2, a.attempt_id, 'm1', undefined, T0), 'AttemptNotOwned');
    code(() => reportDuringMock(db, S1, a.attempt_id, 'zzz', undefined, T0), 'MockItemNotInForm');
    code(() => reportDuringMock(db, S1, a.attempt_id, 'm1', 'x'.repeat(281), T0), 'InvalidDispute');
  });
});

describe('E12: acceptPracticeAnswer', () => {
  const setup = () => {
    const { db } = world({ entitled_until: '2026-12-31' });
    return db;
  };
  it('counts when the item was served while entitled, however late the answer arrives', () => {
    const db = setup();
    const served = new Date('2026-12-31T23:59:00Z');
    expect(acceptPracticeAnswer(db, S1, 'p1', served, new Date('2027-01-20T10:00:00Z'))).toEqual({ counts: true, arrived_after_access_ended: true });
    expect(acceptPracticeAnswer(db, S1, 'p1', served, new Date('2026-12-31T23:59:30Z'))).toEqual({ counts: true, arrived_after_access_ended: false });
  });
  it('refuses an item served after entitled_until with the access-ended refusal', () => {
    const db = setup();
    expect(acceptPracticeAnswer(db, S1, 'p1', new Date('2027-01-01T00:00:00Z'), new Date('2027-01-01T00:05:00Z'))).toEqual({ counts: false, refusal: 'AccessEnded' });
  });
  it('a renewal extends what counts: the rule reads the stored entitled_until', () => {
    const db = setup();
    const served = new Date('2027-01-05T10:00:00Z');
    upsertStudent(db, { student_hash: S1, dt_user_hash: hashId('syn-dt-1', 'salt'), tier: 'pilot', entitled_until: '2027-03-31' }, served);
    expect(acceptPracticeAnswer(db, S1, 'p1', served, served)).toMatchObject({ counts: true }); // entitlement is read as stored now
  });
  it('an unknown student is a named error', () => {
    const db = setup();
    code(() => acceptPracticeAnswer(db, 'nobody', 'p1', T0, T0), 'UnknownStudent');
  });
});
