/**
 * Form registration, starting an attempt, server-side autosave (R21) and submit.
 *
 * Time is always injected (`now`), never read from a clock here. The deadline is
 * the server's: start + the form's minutes (from the exam timing, never a constant).
 */
import { BrainError } from '../errors.js';
import { isServable, type Item } from '../item/schema.js';
import { openOverlayRows } from '../disputes/disputes.js';
import { assertMayStartMock } from '../registry/registry.js';
import { scoreAttempt, type StudentResponse } from '../scoring/scorer.js';
import { formMinutes, type ExamTiming } from './timing.js';
import { freeze, studentItemView, toScorable, type StudentItemView } from './items.js';
import {
  LATE_SYNC_WINDOW_MS, deadlineMs, frozenItems, getForm, getMock, isFinished, isPractice, loadOwned, windowEndMs,
  type Db, type MockContext, type MockRow,
} from './rows.js';
import { settle, settleIfDue } from './settle.js';

// ---------------------------------------------------------------- form (admin)

/** Plan B5: a mock form has at least this many newly authored items. */
export const MIN_FORM_ITEMS = 15;

export interface FormInput {
  form_version: string;
  items: readonly Item[];
  timing: ExamTiming;
  /** Planned cohort close date, shown to students as the unlock date. */
  planned_close?: string | null;
}

/** ADMIN. Register the one fixed mock form. Idempotent for identical content; a changed form needs a new version (errata). */
export function registerForm(db: Db, input: FormInput, now: Date): void {
  if (!input.form_version) throw new BrainError('InvalidMockForm', 'form_version is required');
  if (input.items.length < MIN_FORM_ITEMS) {
    throw new BrainError('InvalidMockForm', `a mock form needs at least ${MIN_FORM_ITEMS} items, got ${input.items.length}`);
  }
  const overlay = openOverlayRows(db);
  const ids = new Set<string>();
  for (const it of input.items) {
    if (it.pool !== 'mock') throw new BrainError('InvalidMockForm', `item ${it.id} is in pool "${it.pool}", not "mock"`);
    if (ids.has(it.id)) throw new BrainError('InvalidMockForm', `item ${it.id} appears twice`);
    ids.add(it.id);
    if (!isServable(it, overlay)) throw new BrainError('InvalidMockForm', `item ${it.id} is not servable`);
    toScorable(it); // refuses items the one scorer cannot grade (e.g. formula answers)
  }
  const frozen = input.items.map(freeze);
  const total = frozen.reduce((a, f) => a + f.marks, 0);
  const minutes = formMinutes(input.timing, total);
  const json = JSON.stringify(frozen);
  const existing = db.prepare('SELECT items_json, minutes FROM mock_forms WHERE form_version = ?').get(input.form_version) as
    | { items_json: string; minutes: number }
    | undefined;
  if (existing) {
    if (existing.items_json === json && existing.minutes === minutes) return;
    throw new BrainError('InvalidMockForm', `form ${input.form_version} already exists with different content; errata need a new form_version`);
  }
  db.prepare(
    'INSERT INTO mock_forms (form_version, minutes, total_marks, items_json, planned_close, registered_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(input.form_version, minutes, total, json, input.planned_close ?? null, now.toISOString());
}

// ---------------------------------------------------------------- start

export interface AttemptView {
  attempt_id: number;
  form_version: string;
  mode: 'scored' | 'practice';
  started_at: string;
  /** The server deadline. The client counts down to it and locks input there (E6). */
  deadline_at: string;
  minutes: number;
  finished: boolean;
  resumed: boolean;
  /** MockAlreadyScored: this attempt is practice; the scored mock stays as it was. */
  notice?: 'MockAlreadyScored' | 'practice_unscored';
}

const view = (row: MockRow, resumed: boolean, notice?: AttemptView['notice']): AttemptView => ({
  attempt_id: row.id,
  form_version: row.form_version,
  mode: isPractice(row) ? 'practice' : 'scored',
  started_at: row.started_at,
  deadline_at: row.deadline_at,
  minutes: row.minutes,
  finished: isFinished(row),
  resumed,
  ...(notice ? { notice } : {}),
});

/**
 * Start (or resume) the student's attempt.
 *  - an unfinished attempt inside its window is resumed, even after access ended (DR7);
 *  - otherwise a NEW attempt needs entitlement (DR7) and the tier's `mock` flag, both checked by
 *    the registry's `assertMayStartMock`; it is the scored one if the student
 *    has none for this form and the form is not closed, else practice (never in the range).
 */
export function startAttempt(db: Db, ctx: MockContext, student: string, formVersion: string, now: Date): AttemptView {
  const form = getForm(db, formVersion);
  return db.transaction((): AttemptView => {
    const mine = db.prepare('SELECT * FROM mocks WHERE student_hash = ? AND form_version = ? ORDER BY id').all(student, formVersion) as MockRow[];
    let scoredExists = false;
    for (const r0 of mine) {
      const r = settleIfDue(db, ctx, r0, now);
      if (!isFinished(r)) return view(r, true); // resume
      if (!isPractice(r)) scoredExists = true;
    }
    // The resume branch above is the DR7 exception: an attempt already started is finished after
    // access ends. Everything below is NEW work and goes through the registry's gate.
    assertMayStartMock(db, student, now, ctx.tiers);
    const practice = scoredExists || form.closed_at !== null;
    const deadline = new Date(now.getTime() + form.minutes * 60_000);
    const id = db
      .prepare(
        `INSERT INTO mocks (student_hash, form_version, state, started_at, deadline_at, minutes, items_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(student, formVersion, practice ? 'practice_only' : 'in_progress', now.toISOString(), deadline.toISOString(), form.minutes, form.items_json)
      .lastInsertRowid as number;
    const notice = scoredExists ? 'MockAlreadyScored' : practice ? 'practice_unscored' : undefined;
    return view(getMock(db, id)!, false, notice);
  })();
}

/** The student's items for an attempt, from the frozen list. Stem and options only; no key, solution, receipt, range or topic. */
export function attemptItems(db: Db, ctx: MockContext, student: string, attemptId: number): StudentItemView[] {
  const row = loadOwned(db, student, attemptId);
  return frozenItems(row).map((f, i) => studentItemView(f, i + 1, ctx.resolveItem(f.item_id)));
}

/** What the student has already saved (for resume after an outage): their own answers only. */
export function savedAnswers(db: Db, student: string, attemptId: number): { item_id: string; response: StudentResponse }[] {
  const row = loadOwned(db, student, attemptId);
  const rows = db
    .prepare('SELECT item_id, response_json FROM mock_answers WHERE mock_id = ? ORDER BY client_entered_at, id')
    .all(row.id) as { item_id: string; response_json: string }[];
  const latest = new Map<string, StudentResponse>();
  for (const r of rows) latest.set(r.item_id, JSON.parse(r.response_json) as StudentResponse);
  return [...latest].map(([item_id, response]) => ({ item_id, response }));
}

/** Like `savedAnswers`, plus the "flag for later" mark; the latest entry per item wins. */
export function savedAnswerState(db: Db, student: string, attemptId: number): { item_id: string; response: StudentResponse; flagged: boolean }[] {
  const row = loadOwned(db, student, attemptId);
  const rows = db
    .prepare('SELECT item_id, response_json, flagged FROM mock_answers WHERE mock_id = ? ORDER BY client_entered_at, id')
    .all(row.id) as { item_id: string; response_json: string; flagged: number }[];
  const latest = new Map<string, { response: StudentResponse; flagged: boolean }>();
  for (const r of rows) latest.set(r.item_id, { response: JSON.parse(r.response_json) as StudentResponse, flagged: r.flagged === 1 });
  return [...latest].map(([item_id, v]) => ({ item_id, ...v }));
}

// ---------------------------------------------------------------- autosave

export interface SaveMeta {
  /** Per queued entry; makes a replay a no-op. */
  idempotencyKey: string;
  /** Server clock when the entry arrived. */
  receivedAt: Date;
  /** Client clock when the answer was entered. */
  clientEnteredAt: Date;
  /** Who the offline queue says owns this entry (E7); must be the signed-in student. */
  queueOwner: string;
  /** DR5: the student's "flag for later" mark. Default false. */
  flagged?: boolean;
}

export interface SaveResult {
  status: 'saved' | 'duplicate';
}

/**
 * R21 autosave. Order of checks: ownership (E7) -> attempt still open -> E3/E6 time rules
 * -> response validity (the scorer's R10 refusals) -> insert, idempotent on
 * (attempt, item, key). A late-sync answer (inside the window) counts and is flagged in
 * `mock_answers.late_sync`; the response never says so ("the result shows nothing different").
 */
export function saveAnswer(
  db: Db, ctx: MockContext, student: string, attemptId: number, itemId: string, response: StudentResponse, meta: SaveMeta,
): SaveResult {
  const row0 = loadOwned(db, student, attemptId);
  if (meta.queueOwner !== student) throw new BrainError('AttemptNotOwned', 'this queued answer belongs to another login and was not sent');
  if (!meta.idempotencyKey) throw new BrainError('InvalidMockRequest', 'idempotencyKey is required');
  const received = meta.receivedAt.getTime();
  const entered = meta.clientEnteredAt.getTime();
  if (!Number.isFinite(received) || !Number.isFinite(entered)) throw new BrainError('InvalidMockRequest', 'receivedAt and clientEnteredAt must be valid times');

  const row = settleIfDue(db, ctx, row0, meta.receivedAt);
  if (isFinished(row)) {
    if (row.submit_reason === 'auto') throw new BrainError('MockLateSubmit', 'the time to sync answers has ended');
    throw new BrainError('MockAttemptClosed', 'this attempt was already submitted');
  }
  if (received >= windowEndMs(row)) throw new BrainError('MockLateSubmit', 'the time to sync answers has ended');
  if (entered > deadlineMs(row)) throw new BrainError('MockLateSubmit', 'the answer was entered after the deadline (E6)');

  const f = frozenItems(row).find((x) => x.item_id === itemId);
  if (!f) throw new BrainError('MockItemNotInForm', `item ${itemId} is not in this attempt`);
  const item = ctx.resolveItem(itemId);
  if (item) scoreAttempt(toScorable(item), response, ctx.marking); // throws InvalidResponse / NatParseError; nothing stored

  const late = received > deadlineMs(row) ? 1 : 0;
  const r = db
    .prepare(
      `INSERT INTO mock_answers (mock_id, item_id, idempotency_key, response_json, client_entered_at, received_at, late_sync, queue_owner, flagged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (mock_id, item_id, idempotency_key) DO NOTHING`,
    )
    .run(row.id, itemId, meta.idempotencyKey, JSON.stringify(response), meta.clientEnteredAt.toISOString(), meta.receivedAt.toISOString(), late, meta.queueOwner, meta.flagged ? 1 : 0);
  return { status: r.changes === 0 ? 'duplicate' : 'saved' };
}

// ---------------------------------------------------------------- submit

export interface SubmitResult {
  attempt_id: number;
  mode: 'scored' | 'practice';
  /** True when the server closed it at the window end rather than the student submitting. */
  auto_closed: boolean;
}

/** Submit. Idempotent; after the window the server has already closed it on the saved answers. */
export function submit(db: Db, ctx: MockContext, student: string, attemptId: number, now: Date): SubmitResult {
  const row0 = loadOwned(db, student, attemptId);
  const row = settleIfDue(db, ctx, row0, now);
  const done = isFinished(row) ? row : settle(db, ctx, row, now, 'submit');
  return { attempt_id: done.id, mode: isPractice(done) ? 'practice' : 'scored', auto_closed: done.submit_reason === 'auto' };
}

export { LATE_SYNC_WINDOW_MS };
