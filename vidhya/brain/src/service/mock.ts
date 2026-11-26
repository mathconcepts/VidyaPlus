/**
 * The /exam mock, over src/mock. This file only translates: wire shapes in, wire shapes out. Every rule
 * (timer, E3 window, E7 owner, R21 autosave, R15 reveal) lives in src/mock and is not repeated here.
 */
import { BrainError } from '../errors.js';
import type { Item } from '../item/schema.js';
import {
  attemptItems, reportDuringMock, resultView, savedAnswerState, saveAnswer, startAttempt, submit,
  frozenItems, getForm, getMock, isFinished, loadOwned, settleIfDue,
  type MockRow, type PostCloseResult,
} from '../mock/index.js';
import type { StudentResponse } from '../scoring/scorer.js';
import type {
  Answer, CheckResult, ExamItem, MockAnswerRequest, MockAnswerResponse, MockAttempt, MockAutosaveRequest, MockAutosaveResponse, MockBrief,
  MockItemLite, MockResultPreClose, MockReviewRow, MockSubmitResponse, ReportRequest, ReportResponse,
} from '../../../shared/api-contract.js';
import { answerToResponse, formatKey, formatNegative, marksOf, optionKey } from './grade.js';
import { fileDispute } from '../disputes/disputes.js';
import { fingerprint } from '../item/schema.js';
import { REPORT_REPLY } from '../mock/report.js';
import { requireFlag, flagsOf, renderedOf, type Deps } from './deps.js';
import { servablePractice, toExamItem } from './practice.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Sun 13 Dec' from a YYYY-MM-DD date or an ISO timestamp (UTC). */
export function fmtDay(iso: string): string {
  const t = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

function config(d: Deps) {
  if (!d.pack.mock) throw new BrainError('MockFormUnknown', 'this pack has no mock');
  return d.pack.mock;
}

export function mockLine(d: Deps, now: Date): string {
  const c = d.pack.mock;
  if (!c) return '';
  const today = now.toISOString().slice(0, 10);
  if (today < c.opens_on) return `Mock opens ${fmtDay(c.opens_on)}`;
  const form = d.db.prepare('SELECT closed_at FROM mock_forms WHERE form_version = ?').get(c.form_version) as { closed_at: string | null } | undefined;
  return form?.closed_at ? 'Mock answers are out' : `Mock is open until ${fmtDay(c.closes_on)}`;
}

const scoredRow = (d: Deps, student: string, form: string): MockRow | undefined =>
  d.db.prepare("SELECT * FROM mocks WHERE student_hash = ? AND form_version = ? AND state IN ('in_progress','scored') ORDER BY id LIMIT 1").get(student, form) as MockRow | undefined;

export function getBrief(d: Deps, student: string, now: Date): MockBrief {
  const c = config(d);
  const form = getForm(d.db, c.form_version);
  let taken: MockBrief['taken'] = 'none';
  const row = scoredRow(d, student, c.form_version);
  if (row) taken = isFinished(settleIfDue(d.db, d.mockCtx, row, now)) ? 'submitted' : 'in-progress';
  const today = now.toISOString().slice(0, 10);
  const phase = form.closed_at ? 'closed' : today < c.opens_on ? 'before-open' : 'open';
  const frozen = JSON.parse(form.items_json) as unknown[];
  const unlock = fmtDay(form.planned_close ?? c.planned_close);
  return {
    phase, taken, opensOn: fmtDay(c.opens_on), closesOn: fmtDay(c.closes_on), unlockOn: unlock,
    minutes: form.minutes, questions: frozen.length, totalMarks: form.total_marks,
    rules: [
      'One scored attempt',
      'The timer keeps running if you leave',
      `Wrong MCQ answers lose marks; MSQ and NAT follow the exam's rules`,
      `Answers unlock for everyone on ${unlock}`,
    ],
  };
}

function toAnswer(item: Item | undefined, r: StudentResponse): Answer | null {
  if (r.skipped) return null;
  if (r.kind === 'mcq' && r.selectedIndex !== undefined) return { kind: 'mcq', key: optionKey(r.selectedIndex) };
  if (r.kind === 'msq' && r.selectedIndices) return { kind: 'msq', keys: r.selectedIndices.map(optionKey) };
  if (r.kind === 'nat' && r.value !== undefined) return { kind: 'nat', raw: String(r.value) };
  void item;
  return null;
}

function view(d: Deps, student: string, row: MockRow, now: Date): MockAttempt {
  const items: MockItemLite[] = [];
  for (const v of attemptItems(d.db, d.mockCtx, student, row.id)) {
    const item = d.pack.byId.get(v.item_id);
    if (!item || v.unavailable) continue; // a withdrawn item is not shown; it counts on neither side
    const html = renderedOf(d, item); // a mock item that cannot render fails loudly (503), never shows raw TeX
    const lite: MockItemLite = {
      id: item.id, kind: item.type.toLowerCase() as MockItemLite['kind'], marks: marksOf(item),
      negative: formatNegative(item, d.pack.marking), stemHtml: html.stem,
    };
    if (item.options) lite.options = item.options.map((o, i) => ({ key: optionKey(i), html: html.options[i]! }));
    items.push(lite);
  }
  const saved: MockAttempt['saved'] = {};
  for (const s of savedAnswerState(d.db, student, row.id)) saved[s.item_id] = { answer: toAnswer(d.pack.byId.get(s.item_id), s.response), flagged: s.flagged };
  return { attemptId: String(row.id), serverNowMs: now.getTime(), deadlineMs: Date.parse(row.deadline_at), items, saved };
}

export function startMock(d: Deps, student: string, now: Date): MockAttempt {
  const c = config(d);
  if (now.toISOString().slice(0, 10) < c.opens_on) throw new BrainError('MockNotClosed', `the mock opens on ${fmtDay(c.opens_on)}`);
  const a = startAttempt(d.db, d.mockCtx, student, c.form_version, now);
  return view(d, student, getMock(d.db, a.attempt_id)!, now);
}

export function parseAttemptId(raw: string): number {
  if (!/^[0-9]{1,12}$/.test(raw)) throw new BrainError('AttemptNotOwned', 'that attempt does not belong to the signed-in student');
  return Number(raw);
}

export function getAttempt(d: Deps, student: string, attemptId: number, now: Date): MockAttempt {
  const row = settleIfDue(d.db, d.mockCtx, loadOwned(d.db, student, attemptId), now);
  if (isFinished(row)) throw new BrainError('MockAttemptClosed', 'this attempt is finished');
  return view(d, student, row, now);
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) throw new BrainError('BadRequest', `${what} is required`);
  return v;
}

export function answerMock(d: Deps, student: string, attemptId: number, req: MockAnswerRequest, now: Date): MockAnswerResponse {
  const itemId = str(req?.itemId, 'itemId');
  const key = str(req.idempotencyKey, 'idempotencyKey');
  const entered = new Date(str(req.enteredAt, 'enteredAt'));
  if (typeof req.flagged !== 'boolean') throw new BrainError('BadRequest', 'flagged must be true or false');
  const item = d.pack.byId.get(itemId);
  loadOwned(d.db, student, attemptId); // ownership before anything else is revealed
  if (!item) throw new BrainError('MockItemNotInForm', `item ${itemId} is not in this attempt`);
  const response: StudentResponse = req.answer === null ? { kind: item.type.toLowerCase() as StudentResponse['kind'], skipped: true } : answerToResponse(item, req.answer);
  const r = saveAnswer(d.db, d.mockCtx, student, attemptId, itemId, response, {
    idempotencyKey: key, receivedAt: now, clientEnteredAt: entered, queueOwner: str(req.queueOwner, 'queueOwner'), flagged: req.flagged,
  });
  return { status: r.status };
}

export function autosave(d: Deps, student: string, attemptId: number, req: MockAutosaveRequest, now: Date): MockAutosaveResponse {
  if (!Array.isArray(req?.entries) || req.entries.length === 0 || req.entries.length > 200) throw new BrainError('BadRequest', 'entries must hold 1 to 200 answers');
  loadOwned(d.db, student, attemptId);
  return {
    results: req.entries.map((e) => {
      const idempotencyKey = typeof e?.idempotencyKey === 'string' ? e.idempotencyKey : '';
      try {
        return { idempotencyKey, status: answerMock(d, student, attemptId, e, now).status };
      } catch (err) {
        if (err instanceof BrainError) return { idempotencyKey, status: 'refused' as const, code: err.code };
        throw err;
      }
    }),
  };
}

export function submitMock(d: Deps, student: string, attemptId: number, now: Date): MockSubmitResponse {
  const r = submit(d.db, d.mockCtx, student, attemptId, now);
  return { attemptId: String(r.attempt_id), mode: r.mode, autoClosed: r.auto_closed };
}

export function getResult(d: Deps, student: string, attemptId: number, now: Date): MockResultPreClose {
  const r = resultView(d.db, d.mockCtx, student, attemptId, now);
  const row = getMock(d.db, attemptId)!;
  return {
    score: r.score, outOf: r.max_marks, right: r.counts.right, wrong: r.counts.wrong, skipped: r.counts.skipped,
    submittedOn: fmtDay(row.submitted_at ?? now.toISOString()),
    unlockOn: r.unlock_date ? fmtDay(r.unlock_date) : fmtDay(config(d).planned_close),
  };
}

export function getReview(d: Deps, student: string, now: Date): MockReviewRow[] {
  const c = config(d);
  const row = d.db
    .prepare("SELECT * FROM mocks WHERE student_hash = ? AND form_version = ? ORDER BY CASE state WHEN 'practice_only' THEN 1 ELSE 0 END, id DESC LIMIT 1")
    .get(student, c.form_version) as MockRow | undefined;
  if (!row) throw new BrainError('MockNotSubmitted', 'you have no attempt to review');
  if (!getForm(d.db, c.form_version).closed_at) throw new BrainError('MockNotClosed', 'answers unlock when the mock closes');
  const res = resultView(d.db, d.mockCtx, student, row.id, now) as PostCloseResult;
  return res.review.map((r): MockReviewRow => {
    const item = d.pack.byId.get(r.item_id);
    if (!item || r.state === 'withdrawn') {
      const ghost: ExamItem = {
        id: r.item_id, topic: '', topicLabel: '', kind: item ? (item.type.toLowerCase() as ExamItem['kind']) : 'mcq', marks: item ? marksOf(item) : 1, negative: '0',
        stemHtml: 'This question was withdrawn.', fingerprint: item ? fingerprint(item) : '', verification: { state: 'withdrawn' }, inMock: true,
      };
      return { item: ghost, result: { itemId: r.item_id, outcome: 'skipped', yours: '', key: '', reason: 'Withdrawn: it counts on neither side.', scored: 0, week: null, verification: { state: 'withdrawn' } } };
    }
    let ex: ExamItem;
    let reasonHtml: string | undefined;
    try {
      ex = toExamItem(d, item);
      reasonHtml = renderedOf(d, item).solution;
    } catch (e) {
      if (!(e instanceof BrainError) || (e.code !== 'RenderFailed' && e.code !== 'RenderMissing')) throw e;
      // One question that cannot be drawn must not take the whole review down; raw TeX is still never shown.
      ex = {
        id: item.id, topic: item.topic_id, topicLabel: '', kind: item.type.toLowerCase() as ExamItem['kind'], marks: marksOf(item), negative: '0',
        stemHtml: 'This question cannot be shown right now. We are re-checking it.', fingerprint: fingerprint(item),
        verification: { state: 'rechecking', note: 'Not shown while we re-check it.' },
      };
    }
    ex.inMock = true;
    const yours = r.your_answer ? toAnswer(item, r.your_answer) : null;
    const result: CheckResult = {
      itemId: item.id, outcome: yours === null ? 'skipped' : r.correct ? 'correct' : 'wrong',
      yours: yours === null ? '' : yours.kind === 'mcq' ? yours.key : yours.kind === 'msq' ? yours.keys.join(', ') : yours.raw,
      key: formatKey(item), reason: item.solution.text, scored: r.marks_awarded, week: null, verification: ex.verification,
    };
    if (reasonHtml !== undefined) result.reasonHtml = reasonHtml;
    return { item: ex, result };
  });
}

export function report(d: Deps, student: string, req: ReportRequest, now: Date): ReportResponse {
  const itemId = str(req?.itemId, 'itemId');
  const note = typeof req.note === 'string' ? req.note : undefined;
  if (req.context === 'mock') {
    const c = config(d);
    const rows = d.db.prepare('SELECT * FROM mocks WHERE student_hash = ? AND form_version = ? ORDER BY id DESC').all(student, c.form_version) as MockRow[];
    const row = rows.find((r) => frozenItems(r).some((f) => f.item_id === itemId));
    if (!row) throw new BrainError('MockItemNotInForm', `item ${itemId} is not in your attempt`);
    const r = reportDuringMock(d.db, student, row.id, itemId, note, now);
    return { ok: true, message: r.message };
  }
  if (req.context !== 'item') throw new BrainError('BadRequest', 'context must be "item" or "mock"');
  requireFlag(d, student, now, 'disputes');
  const item = servablePractice(d, student, itemId);
  const out = fileDispute(d.db, { item_id: itemId, fingerprint: fingerprint(item), student_hash: student, channel: 'exam', note }, now);
  return {
    ok: true,
    message: out.outcome === 'rate_limited' ? 'Noted. You have reached today\'s report limit; we still read every report.' : 'Thanks. This question is hidden for you while we check it.',
  };
}
export { REPORT_REPLY, flagsOf };
