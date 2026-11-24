/**
 * ADMIN operations: the cohort close (R15, E6) and the audited reset (R21).
 * Both write append-only `mock_audit` rows. The CLI layer decides who may call
 * them (Giri only); here an actor is required so every row names one.
 */
import { BrainError } from '../errors.js';
import { getForm, getMock, isFinished, isPractice, windowEndMs, type Db, type MockContext, type MockRow } from './rows.js';
import { settleIfDue, sweepDue } from './settle.js';

function audit(
  db: Db, now: Date,
  a: { action: 'reset' | 'close'; form_version: string; student_hash?: string; mock_id?: number; actor: string; reason?: string; detail?: unknown },
): void {
  db.prepare('INSERT INTO mock_audit (ts, action, form_version, student_hash, mock_id, actor, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    now.toISOString(), a.action, a.form_version, a.student_hash ?? null, a.mock_id ?? null, a.actor, a.reason ?? null,
    a.detail === undefined ? null : JSON.stringify(a.detail),
  );
}

export interface CloseResult {
  form_version: string;
  closed_at: string;
  /** Attempts the server closed on their saved answers while closing. */
  auto_closed: number;
  already_closed: boolean;
}

/**
 * `vidhya mock close`. Refuses (MockCloseTooEarly) while any attempt of the form
 * still has an open window, i.e. its deadline + 2 min is in the future (E6). A
 * submitted attempt never blocks. Idempotent once closed.
 */
export function closeMock(db: Db, ctx: MockContext, formVersion: string, actor: string, now: Date): CloseResult {
  if (!actor) throw new BrainError('InvalidMockRequest', 'closing a mock must name its actor');
  const form = getForm(db, formVersion);
  if (form.closed_at) return { form_version: formVersion, closed_at: form.closed_at, auto_closed: 0, already_closed: true };
  return db.transaction((): CloseResult => {
    const open = db.prepare('SELECT * FROM mocks WHERE form_version = ? AND submitted_at IS NULL').all(formVersion) as MockRow[];
    const blocking = open.filter((r) => windowEndMs(r) > now.getTime());
    if (blocking.length > 0) {
      const next = new Date(Math.max(...blocking.map(windowEndMs))).toISOString();
      throw new BrainError('MockCloseTooEarly', `${blocking.length} attempt(s) still have an open window; try again after ${next}`);
    }
    const auto = sweepDue(db, ctx, formVersion, now);
    const closedAt = now.toISOString();
    db.prepare('UPDATE mock_forms SET closed_at = ?, closed_by = ? WHERE form_version = ?').run(closedAt, actor, formVersion);
    audit(db, now, { action: 'close', form_version: formVersion, actor, detail: { auto_closed: auto } });
    return { form_version: formVersion, closed_at: closedAt, auto_closed: auto, already_closed: false };
  })();
}

export interface ResetInput {
  student: string;
  form_version: string;
  reason: string;
  actor: string;
  /** Minutes to give back. Default: what was left at the student's last saved answer (min 1). */
  minutes?: number;
}

export interface ResetResult {
  attempt_id: number;
  deadline_at: string;
  minutes_given: number;
}

/**
 * R21: reopen the student's SCORED attempt when an outage covered its window. Saved
 * answers are kept; the deadline is re-issued by the server. Refused once the
 * form is closed (the keys are out) and for an attempt that is still running.
 */
export function resetAttempt(db: Db, ctx: MockContext, input: ResetInput, now: Date): ResetResult {
  if (!input.actor) throw new BrainError('InvalidMockRequest', 'a reset must name its actor');
  if (!input.reason?.trim()) throw new BrainError('InvalidMockRequest', 'a reset needs a reason');
  if (input.minutes !== undefined && !(input.minutes > 0)) throw new BrainError('InvalidMockRequest', 'minutes must be > 0');
  const form = getForm(db, input.form_version);
  if (form.closed_at) throw new BrainError('MockClosed', 'the form is closed; its keys are out, so an attempt cannot be reopened');
  return db.transaction((): ResetResult => {
    const found = db
      .prepare("SELECT * FROM mocks WHERE student_hash = ? AND form_version = ? AND state IN ('in_progress','scored')")
      .get(input.student, input.form_version) as MockRow | undefined;
    if (!found) throw new BrainError('MockNotResettable', 'this student has no scored attempt on this form');
    const row = settleIfDue(db, ctx, found, now);
    if (!isFinished(row) || isPractice(row)) throw new BrainError('MockNotResettable', 'the attempt is still running; there is nothing to reopen');
    const last = db.prepare('SELECT MAX(client_entered_at) AS t FROM mock_answers WHERE mock_id = ?').get(row.id) as { t: string | null };
    const lastAt = Date.parse(last.t ?? row.started_at);
    const leftMin = Math.max(0, (Date.parse(row.deadline_at) - lastAt) / 60_000);
    const given = input.minutes ?? Math.min(row.minutes, Math.max(1, Math.ceil(leftMin)));
    const deadline = new Date(now.getTime() + given * 60_000);
    db.prepare(
      `UPDATE mocks SET state = 'in_progress', submitted_at = NULL, submit_reason = NULL, score = NULL, result_json = NULL, deadline_at = ?
       WHERE id = ?`,
    ).run(deadline.toISOString(), row.id);
    audit(db, now, {
      action: 'reset', form_version: input.form_version, student_hash: input.student, mock_id: row.id, actor: input.actor, reason: input.reason,
      detail: { old_deadline_at: row.deadline_at, new_deadline_at: deadline.toISOString(), minutes_given: given, was: row.submit_reason },
    });
    return { attempt_id: getMock(db, row.id)!.id, deadline_at: deadline.toISOString(), minutes_given: given };
  })();
}
