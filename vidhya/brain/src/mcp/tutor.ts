/**
 * Tutor tools (X1). IDENTITY-FREE: no tool takes or returns a student, and none records an attempt.
 *   check_answer    grades only. No key in the reply.
 *   explain_receipt method, engines, reviewer and date. Never values.
 *   report_item     anonymous; goes to Giri's review queue only, never quarantines (O2).
 * Every tool refuses a mock-pool item (MockItemRefused, R7/T4), so a prompt-injected tutor cannot reach a mock.
 */
import { BrainError } from '../errors.js';
import { fingerprint, isServable, type Item } from '../item/schema.js';
import { openOverlayRows, queueForReview } from '../disputes/disputes.js';
import { parseReceipt } from '../item/receipt.js';
import type { Answer } from '../../../shared/api-contract.js';
import { answerToResponse, gradeItem } from '../service/grade.js';
import type { Deps } from '../service/deps.js';

export interface CheckAnswerOut { correct: boolean; marks_awarded: number; max: number; feedback: string; key_revealed: false }
export interface ExplainReceiptOut {
  item_id: string;
  verified: boolean;
  method: string | null;
  engines: string[];
  engines_agree: boolean | null;
  reviewer: string | null;
  reviewed_at: string | null;
}

/** Report cap for the whole tutor channel: a looping or injected tutor cannot flood Giri's queue. */
export const REPORTS_PER_MINUTE = 20;

function tutorItem(d: Deps, id: unknown): Item {
  if (typeof id !== 'string') throw new BrainError('BadRequest', 'item_id is required');
  const item = d.pack.byId.get(id);
  if (item?.pool === 'mock') throw new BrainError('MockItemRefused', 'the tutor cannot help with mock questions');
  if (!item || !isServable(item, openOverlayRows(d.db))) throw new BrainError('ItemNotFound', 'no such question');
  return item;
}

export function makeTutorTools(d: Deps, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  let windowStart = 0;
  let count = 0;
  return {
    check_answer(input: { item_id: string; answer: Answer }): CheckAnswerOut {
      const item = tutorItem(d, input?.item_id);
      const g = gradeItem(item, answerToResponse(item, input.answer), d.pack.marking);
      return { correct: g.correct, marks_awarded: g.marks_awarded, max: g.max, feedback: g.feedback, key_revealed: false };
    },
    explain_receipt(input: { item_id: string }): ExplainReceiptOut {
      const item = tutorItem(d, input?.item_id);
      const r = parseReceipt(item.receipt);
      const fp = fingerprint(item);
      const valid = !!r && r.agree && r.fingerprint === fp;
      return {
        item_id: item.id,
        verified: valid,
        method: r?.method ?? null,
        engines: r?.engines ?? [],
        engines_agree: r ? r.agree : null,
        reviewer: r?.reviewer ?? null,
        reviewed_at: r?.reviewed_at ?? null,
      };
    },
    report_item(input: { item_id: string; note?: string }): { ok: true; message: string } {
      const item = tutorItem(d, input?.item_id);
      const t = now().getTime();
      if (t - windowStart >= 60_000) { windowStart = t; count = 0; }
      if (++count > REPORTS_PER_MINUTE) throw new BrainError('RateLimited', 'too many reports; wait a minute');
      queueForReview(d.db, { item_id: item.id, fingerprint: fingerprint(item), student_hash: null, note: input.note }, now());
      return { ok: true, message: 'Sent to the reviewer. The question stays as it is until it is checked.' };
    },
  };
}
