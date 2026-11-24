/** Closing an attempt: by submit, or automatically when the E3 window ends. One scoring path (score.ts). */
import { computeOutcomes, totals } from './score.js';
import { isFinished, windowEndMs, getMock, type Db, type MockContext, type MockRow } from './rows.js';

/**
 * Score and close an attempt. A scored attempt moves in_progress -> scored; a
 * practice attempt keeps state practice_only and gets `submitted_at`. An auto
 * close is stamped at the window end, not at the moment someone noticed.
 */
export function settle(db: Db, ctx: MockContext, row: MockRow, now: Date, reason: 'submit' | 'auto'): MockRow {
  if (isFinished(row)) return row;
  const t = totals(computeOutcomes(db, ctx, row));
  const at = reason === 'auto' ? new Date(windowEndMs(row)) : now;
  db.prepare(
    `UPDATE mocks SET state = CASE WHEN state = 'in_progress' THEN 'scored' ELSE state END,
       submitted_at = ?, score = ?, result_json = ?, submit_reason = ?
     WHERE id = ? AND submitted_at IS NULL`,
  ).run(at.toISOString(), t.score, JSON.stringify(t), reason, row.id);
  return getMock(db, row.id)!;
}

/** Lazy auto-close (no timers): an unfinished attempt past its window is closed on the next touch. */
export function settleIfDue(db: Db, ctx: MockContext, row: MockRow, now: Date): MockRow {
  if (!isFinished(row) && now.getTime() >= windowEndMs(row)) return settle(db, ctx, row, now, 'auto');
  return row;
}

/** Auto-close every unfinished attempt of a form whose window has ended. Returns how many. */
export function sweepDue(db: Db, ctx: MockContext, formVersion: string, now: Date): number {
  const open = db.prepare('SELECT * FROM mocks WHERE form_version = ? AND submitted_at IS NULL').all(formVersion) as MockRow[];
  let n = 0;
  for (const r of open) if (settleIfDue(db, ctx, r, now).submitted_at !== null && r.submitted_at === null) n++;
  return n;
}
