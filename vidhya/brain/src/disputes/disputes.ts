/**
 * B6 + O2 disputes. Rules:
 *  - An identified student's report hides the item for THAT student only.
 *  - Cohort-wide quarantine (an `item_status` 'disputed' row) needs 2 DISTINCT
 *    identified students on the same item+fingerprint, or an admin call.
 *  - Cap: 3 counted disputes per student per UTC day; beyond that the report is
 *    logged (counted = 0) and never counts toward quorum or storm.
 *  - Storm: more than 5 DISTINCT items disputed (counted, identified) in a UTC
 *    day pauses auto-quarantine. `onStorm` is the alert hook; no network here.
 *  - Anonymous MCP reports go to Giri's review queue only; they never count,
 *    never quarantine, never trip the storm.
 *  - Notes are <= 280 chars, stored, and returned only by `adminReviewQueue`.
 *  - Every overlay change writes an append-only `overlay_audit` row.
 */
import Database from 'better-sqlite3';
import { BrainError } from '../errors.js';
import type { OverlayRow } from '../item/schema.js';

type Db = Database.Database;

export const QUORUM = 2;
export const DAILY_CAP = 3;
export const STORM_DISTINCT_ITEMS = 5;
export const NOTE_MAX = 280;

export interface DisputeInput {
  item_id: string;
  fingerprint: string;
  /** Hashed student id; null only for the anonymous MCP channel. */
  student_hash: string | null;
  channel: 'exam' | 'mcp';
  note?: string;
}

export type DisputeOutcome = 'hidden_for_reporter' | 'quarantined' | 'queued_for_review' | 'rate_limited' | 'duplicate';

export interface DisputeResult {
  outcome: DisputeOutcome;
  /** True when auto-quarantine is paused for this UTC day. */
  storm: boolean;
  /** True when the alert callback threw; the dispute itself was saved. */
  alert_failed: boolean;
}

export interface StormEvent {
  day: string;
  distinct_items: number;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function distinctItemsToday(db: Db, day: string): number {
  return (
    db
      .prepare("SELECT COUNT(DISTINCT item_id) AS n FROM disputes WHERE day = ? AND counted = 1 AND channel = 'exam'")
      .get(day) as { n: number }
  ).n;
}

function hasOpenOverlay(db: Db, itemId: string, fp: string): boolean {
  return !!db.prepare('SELECT 1 FROM item_status WHERE item_id = ? AND fingerprint = ? AND closed_at IS NULL').get(itemId, fp);
}

function audit(db: Db, now: Date, itemId: string, fp: string, action: string, actor: string, detail: string | null): void {
  db.prepare('INSERT INTO overlay_audit (ts, item_id, fingerprint, action, actor, detail) VALUES (?, ?, ?, ?, ?, ?)').run(
    now.toISOString(), itemId, fp, action, actor, detail,
  );
}

function quarantine(db: Db, now: Date, itemId: string, fp: string, reason: string, action: 'quarantine_quorum' | 'quarantine_admin', actor: string): boolean {
  if (hasOpenOverlay(db, itemId, fp)) return false;
  db.prepare("INSERT INTO item_status (item_id, fingerprint, status, reason, since) VALUES (?, ?, 'disputed', ?, ?)").run(itemId, fp, reason, now.toISOString());
  db.prepare("UPDATE disputes SET state = 'quarantined' WHERE item_id = ? AND fingerprint = ? AND state IN ('open','hidden_for_reporter')").run(itemId, fp);
  audit(db, now, itemId, fp, action, actor, reason);
  return true;
}

export function fileDispute(db: Db, input: DisputeInput, now: Date, opts: { onStorm?: (e: StormEvent) => void } = {}): DisputeResult {
  if (!input.item_id || !input.fingerprint) throw new BrainError('InvalidDispute', 'item_id and fingerprint are required');
  if (input.channel === 'exam' && !input.student_hash) throw new BrainError('InvalidDispute', 'an exam-channel dispute needs an identified student');
  if (input.channel === 'mcp' && input.student_hash !== null) throw new BrainError('InvalidDispute', 'an mcp-channel dispute must be anonymous');
  const note = input.note ?? null;
  if (note !== null && note.length > NOTE_MAX) throw new BrainError('InvalidDispute', `note is ${note.length} chars; the limit is ${NOTE_MAX}`);

  const day = utcDay(now);
  const ts = now.toISOString();
  let stormCrossed: StormEvent | null = null;

  const result = db.transaction((): Omit<DisputeResult, 'alert_failed'> => {
    const insert = (state: string, counted: 0 | 1) =>
      db
        .prepare('INSERT INTO disputes (item_id, fingerprint, student_hash, channel, note, day, counted, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(input.item_id, input.fingerprint, input.student_hash, input.channel, note, day, counted, state, ts);
    const stormNow = () => distinctItemsToday(db, day) > STORM_DISTINCT_ITEMS;

    if (input.channel === 'mcp') {
      insert('giri_queue', 0);
      return { outcome: 'queued_for_review', storm: stormNow() };
    }

    const dup = db.prepare('SELECT 1 FROM disputes WHERE student_hash = ? AND item_id = ? AND fingerprint = ?').get(input.student_hash, input.item_id, input.fingerprint);
    if (dup) return { outcome: 'duplicate', storm: stormNow() };

    const used = (db.prepare("SELECT COUNT(*) AS n FROM disputes WHERE student_hash = ? AND day = ? AND counted = 1").get(input.student_hash, day) as { n: number }).n;
    if (used >= DAILY_CAP) {
      insert('logged_only', 0);
      return { outcome: 'rate_limited', storm: stormNow() };
    }

    const stormBefore = stormNow();
    insert('hidden_for_reporter', 1);
    const distinct = distinctItemsToday(db, day);
    const storm = distinct > STORM_DISTINCT_ITEMS;
    if (storm && !stormBefore) stormCrossed = { day, distinct_items: distinct };

    const reporters = (
      db
        .prepare("SELECT COUNT(DISTINCT student_hash) AS n FROM disputes WHERE item_id = ? AND fingerprint = ? AND counted = 1 AND channel = 'exam'")
        .get(input.item_id, input.fingerprint) as { n: number }
    ).n;
    if (reporters >= QUORUM && !storm) {
      quarantine(db, now, input.item_id, input.fingerprint, `quorum of ${reporters} distinct students`, 'quarantine_quorum', 'system');
      return { outcome: 'quarantined', storm };
    }
    return { outcome: 'hidden_for_reporter', storm };
  })();

  let alert_failed = false;
  if (stormCrossed && opts.onStorm) {
    try {
      opts.onStorm(stormCrossed);
    } catch {
      alert_failed = true; // surfaced to the caller, never swallowed
    }
  }
  return { ...result, alert_failed };
}

/** Items this student reported and should no longer see. Notes are never returned. */
export function hiddenItemIdsFor(db: Db, studentHash: string): Set<string> {
  const rows = db
    .prepare("SELECT DISTINCT item_id FROM disputes WHERE student_hash = ? AND state IN ('hidden_for_reporter','quarantined')")
    .all(studentHash) as { item_id: string }[];
  return new Set(rows.map((r) => r.item_id));
}

/** Open overlay rows, the input to `isServable`. */
export function openOverlayRows(db: Db): OverlayRow[] {
  return db.prepare('SELECT item_id, fingerprint, status, closed_at FROM item_status WHERE closed_at IS NULL').all() as OverlayRow[];
}

export function isStormPaused(db: Db, now: Date): boolean {
  return distinctItemsToday(db, utcDay(now)) > STORM_DISTINCT_ITEMS;
}

/** Admin call (Giri): quarantine now. Returns false if an open row already exists. */
export function adminQuarantine(db: Db, a: { item_id: string; fingerprint: string; actor: string; reason: string }, now: Date): boolean {
  if (!a.actor) throw new BrainError('InvalidDispute', 'an admin quarantine must name its actor');
  return db.transaction(() => quarantine(db, now, a.item_id, a.fingerprint, a.reason, 'quarantine_admin', a.actor))();
}

/** Admin call: close the open overlay row. Needs a named actor (re-clearing is Giri's named review). */
export function adminRestore(db: Db, a: { item_id: string; fingerprint: string; actor: string; reason: string }, now: Date): boolean {
  if (!a.actor) throw new BrainError('InvalidDispute', 'an admin restore must name its actor');
  return db.transaction(() => {
    const r = db
      .prepare('UPDATE item_status SET closed_at = ? WHERE item_id = ? AND fingerprint = ? AND closed_at IS NULL')
      .run(now.toISOString(), a.item_id, a.fingerprint);
    if (r.changes === 0) return false;
    db.prepare("UPDATE disputes SET state = 'resolved_cleared' WHERE item_id = ? AND fingerprint = ? AND state IN ('hidden_for_reporter','quarantined')").run(a.item_id, a.fingerprint);
    audit(db, now, a.item_id, a.fingerprint, 'restore_admin', a.actor, a.reason);
    return true;
  })();
}

/** ADMIN ONLY (Giri's queue). The only function that returns notes. */
export function adminReviewQueue(db: Db): { item_id: string; fingerprint: string; channel: string; state: string; note: string | null; created_at: string }[] {
  return db
    .prepare("SELECT item_id, fingerprint, channel, state, note, created_at FROM disputes WHERE state IN ('giri_queue','logged_only','hidden_for_reporter','quarantined') ORDER BY created_at")
    .all() as never;
}
