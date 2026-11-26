/**
 * Outside voice #3 / T29: before `vidhya mock close`, nothing key-shaped may leave any
 * student-facing function. This test walks every returned object, and it fails when a
 * new function is exported without being classified, so a new surface cannot skip it.
 */
import { describe, it, expect } from 'vitest';
import * as mock from '../index.js';
import * as disputes from '../../disputes/disputes.js';
import { BrainError } from '../../errors.js';
import { world, T0, min, at, meta, mcq, S1, S2, SECRET_KEY_TEXT, SECRET_RECEIPT } from './fixtures.js';

const FORBIDDEN_KEY = /^(key|answer_?index(es|ices)?|answer_?range|nat_range|solution|receipt|topic.*|concept.*|fingerprint|grading_fp)$/i;
const SENTINELS = [SECRET_KEY_TEXT, SECRET_RECEIPT.engine, 'topic-secret', 'concept-secret'];

/** Returns every leak found: forbidden field names anywhere in the object graph, and sentinel strings in any value. */
function leaks(value: unknown, trail = '$', seen = new Set<unknown>()): string[] {
  const out: string[] = [];
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') for (const s of SENTINELS) if (value.includes(s)) out.push(`${trail} contains ${s}`);
    return out;
  }
  if (seen.has(value)) return out;
  seen.add(value);
  if (value instanceof Date) return out;
  if (value instanceof Set || Array.isArray(value)) {
    [...(value as Iterable<unknown>)].forEach((v, i) => out.push(...leaks(v, `${trail}[${i}]`, seen)));
    return out;
  }
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  for (const [k, v] of entries) {
    if (FORBIDDEN_KEY.test(String(k))) out.push(`${trail}.${String(k)} is a forbidden field`);
    if (typeof k === 'string') for (const s of SENTINELS) if (k.includes(s)) out.push(`${trail} key name contains ${s}`);
    out.push(...leaks(v, `${trail}.${String(k)}`, seen));
  }
  return out;
}

// Every exported function must be listed in exactly one of these.
const STUDENT_MOCK = ['startAttempt', 'attemptItems', 'savedAnswers', 'saveAnswer', 'submit', 'resultView', 'reportDuringMock', 'acceptPracticeAnswer', 'savedAnswerState'];
const ADMIN_MOCK = ['registerForm', 'closeMock', 'resetAttempt', 'sweepDue'];
const INTERNAL_MOCK = [
  'parseExamTiming', 'formMinutes', 'toScorable', 'freeze', 'studentItemView', 'getForm', 'getMock', 'loadOwned', 'frozenItems', 'isPractice',
  'isFinished', 'deadlineMs', 'windowEndMs', 'effectiveResponses', 'computeOutcomes', 'totals', 'settle', 'settleIfDue',
];
const STUDENT_DISPUTES = ['fileDispute', 'hiddenItemIdsFor', 'isStormPaused'];
const ADMIN_DISPUTES = ['adminQuarantine', 'adminRestore', 'adminReviewQueue', 'queueForReview', 'openOverlayRows'];

const fnNames = (m: object) => Object.entries(m).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();

describe('every exported function is classified', () => {
  it('src/mock', () => {
    expect(fnNames(mock)).toEqual([...STUDENT_MOCK, ...ADMIN_MOCK, ...INTERNAL_MOCK].sort());
  });
  it('src/disputes', () => {
    expect(fnNames(disputes)).toEqual([...STUDENT_DISPUTES, ...ADMIN_DISPUTES].sort());
  });
});

describe('the walker itself', () => {
  it('finds forbidden fields, nested, in arrays, Maps and Sets, and sentinel strings', () => {
    expect(leaks({ a: [{ answerIndex: 1 }] })).toHaveLength(1);
    expect(leaks({ a: { nat_range: [1, 2] }, b: { Solution: 'x' } })).toHaveLength(2);
    expect(leaks(new Map([['receipt', 1]]))).toHaveLength(1);
    expect(leaks(new Set([{ topic_id: 't' }]))).toHaveLength(1);
    expect(leaks({ x: `hello ${SECRET_KEY_TEXT}` })).toHaveLength(1);
    expect(leaks({ ok: 1, selectedIndex: 2, label: 'unproctored practice mock' })).toEqual([]);
  });
});

describe('before close, no student-facing function leaks anything key-shaped', () => {
  it('walks every returned value across a full sitting, a practice attempt, a report, a dispute and the refusals', () => {
    const { db, ctx, items } = world();
    const returned: Record<string, unknown> = {};
    const note = (name: string, v: unknown) => { returned[name] = v; return v; };

    const a = mock.startAttempt(db, ctx, S1, 'f1', T0);
    note('startAttempt', a);
    note('startAttempt:resume', mock.startAttempt(db, ctx, S1, 'f1', at(T0, min(1))));
    note('attemptItems', mock.attemptItems(db, ctx, S1, a.attempt_id));
    note('saveAnswer', mock.saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(1)), at(T0, min(1)), 'x')));
    note('saveAnswer:dup', mock.saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(1)), at(T0, min(1)), 'x')));
    note('savedAnswers', mock.savedAnswers(db, S1, a.attempt_id));
    note('savedAnswerState', mock.savedAnswerState(db, S1, a.attempt_id));
    note('reportDuringMock', mock.reportDuringMock(db, S1, a.attempt_id, 'm2', 'check the key', at(T0, min(2))));
    note('submit', mock.submit(db, ctx, S1, a.attempt_id, at(T0, min(3))));
    note('resultView', mock.resultView(db, ctx, S1, a.attempt_id, at(T0, min(4))));
    const p = mock.startAttempt(db, ctx, S1, 'f1', at(T0, min(5))); // a second, practice attempt
    note('startAttempt:practice', p);
    note('attemptItems:practice', mock.attemptItems(db, ctx, S1, p.attempt_id));
    mock.submit(db, ctx, S1, p.attempt_id, at(T0, min(6)));
    note('resultView:practice', mock.resultView(db, ctx, S1, p.attempt_id, at(T0, min(7))));
    note('acceptPracticeAnswer', mock.acceptPracticeAnswer(db, S1, 'p1', at(T0, min(8)), at(T0, min(9))));
    note('acceptPracticeAnswer:refused', mock.acceptPracticeAnswer(db, S1, 'p1', new Date('2027-02-01T00:00:00Z'), new Date('2027-02-01T00:00:00Z')));
    note('fileDispute', disputes.fileDispute(db, { item_id: 'practice-1', fingerprint: 'a'.repeat(64), student_hash: S2, channel: 'exam', note: 'wrong key?' }, at(T0, min(9))));
    note('hiddenItemIdsFor', disputes.hiddenItemIdsFor(db, S2));
    note('isStormPaused', disputes.isStormPaused(db, at(T0, min(9))));

    // a withdrawn item mid-mock must not show up either
    const b = mock.startAttempt(db, ctx, S2, 'f1', T0);
    disputes.adminQuarantine(db, { item_id: 'm3', fingerprint: mock.freeze(items.get('m3')!).fingerprint, actor: 'admin-1', reason: 'r' }, at(T0, min(1)));
    note('attemptItems:withdrawn', mock.attemptItems(db, ctx, S2, b.attempt_id));
    mock.submit(db, ctx, S2, b.attempt_id, at(T0, min(2)));
    note('resultView:withdrawn', mock.resultView(db, ctx, S2, b.attempt_id, at(T0, min(3))));

    // refusals carry messages: they must not leak either
    const errors: string[] = [];
    const attempt = (fn: () => unknown) => { try { fn(); } catch (e) { errors.push(e instanceof BrainError ? `${e.code}: ${e.message}` : String(e)); } };
    attempt(() => mock.saveAnswer(db, ctx, S1, a.attempt_id, 'm1', mcq(1), meta(S1, at(T0, min(4)))));
    attempt(() => mock.saveAnswer(db, ctx, S2, a.attempt_id, 'm1', mcq(1), meta(S2, T0)));
    attempt(() => mock.saveAnswer(db, ctx, S2, b.attempt_id, 'm1', mcq(99), meta(S2, T0)));
    attempt(() => mock.resultView(db, ctx, S1, 12345, T0));
    attempt(() => mock.reportDuringMock(db, S2, a.attempt_id, 'm2', undefined, T0));
    attempt(() => mock.startAttempt(db, ctx, S1, 'nope', T0));
    expect(errors.length).toBe(6);

    // every student-facing function was exercised
    const exercised = new Set(Object.keys(returned).map((k) => k.split(':')[0]));
    for (const f of [...STUDENT_MOCK, ...STUDENT_DISPUTES]) expect(exercised.has(f), `${f} was not exercised`).toBe(true);

    expect(leaks(returned)).toEqual([]);
    expect(errors.flatMap((e) => SENTINELS.filter((s) => e.includes(s)))).toEqual([]);
    // the pre-close result really is just the tally
    expect(Object.keys(returned['resultView'] as object).sort()).toEqual(['counts', 'label', 'max_marks', 'revealed', 'score', 'unlock_date']);
  });

  it('after close the same walker does find the review, so a pass above is meaningful', () => {
    const { db, ctx } = world();
    const a = mock.startAttempt(db, ctx, S1, 'f1', T0);
    mock.submit(db, ctx, S1, a.attempt_id, at(T0, min(1)));
    mock.closeMock(db, ctx, 'f1', 'admin-1', at(T0, min(2)));
    const after = mock.resultView(db, ctx, S1, a.attempt_id, at(T0, min(3)));
    expect(leaks(after).length).toBeGreaterThan(0);
  });
});
