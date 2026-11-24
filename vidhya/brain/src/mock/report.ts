/** DR18: "Report a problem" during the mock. Review queue only; nothing key-shaped in the reply. */
import { queueForReview } from '../disputes/disputes.js';
import { BrainError } from '../errors.js';
import { frozenItems, loadOwned, type Db } from './rows.js';

export const REPORT_REPLY = 'Sent. We review mock reports after the close date. Answer as best you can.';

/**
 * Files the report into Giri's queue (state giri_queue, not counted). It never hides the
 * item, never counts toward quorum and never quarantines; the reply is identical whether
 * the report was new or a repeat, and says nothing about the item.
 */
export function reportDuringMock(db: Db, student: string, attemptId: number, itemId: string, note: string | undefined, now: Date): { ok: true; message: string } {
  const row = loadOwned(db, student, attemptId);
  const f = frozenItems(row).find((x) => x.item_id === itemId);
  if (!f) throw new BrainError('MockItemNotInForm', `item ${itemId} is not in this attempt`);
  queueForReview(db, { item_id: itemId, fingerprint: f.fingerprint, student_hash: student, note }, now);
  return { ok: true, message: REPORT_REPLY };
}
