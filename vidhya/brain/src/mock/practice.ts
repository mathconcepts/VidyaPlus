/**
 * E12: an offline PRACTICE answer that reaches the server after `entitled_until`.
 * It counts if the server SERVED the item (server time) while the student was entitled,
 * whenever the answer arrives. An item served after access ended is refused with the
 * DR7 banner. (Mock answers follow DR7 + E3 instead; see attempts.ts.)
 */
import { entitledAt, getStudent } from '../registry/registry.js';
import type { Db } from './rows.js';

export type PracticeDecision =
  | { counts: true; arrived_after_access_ended: boolean }
  | { counts: false; refusal: 'AccessEnded' };

export function acceptPracticeAnswer(db: Db, student: string, itemId: string, servedAt: Date, receivedAt: Date): PracticeDecision {
  void itemId; // the rule is per student and served time; the id is kept for the caller's log line
  const row = getStudent(db, student);
  if (!entitledAt(row, servedAt)) return { counts: false, refusal: 'AccessEnded' };
  return { counts: true, arrived_after_access_ended: !entitledAt(row, receivedAt) };
}
