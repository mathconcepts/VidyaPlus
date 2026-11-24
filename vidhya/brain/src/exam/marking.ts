/**
 * Exam marking, read from a pack's `exam.yaml` (plan K2). Fork Test law:
 * this module names no exam. Every number arrives as data; the scorer
 * holds no defaults of its own.
 */
import { BrainError } from '../errors.js';

export interface ExamMarking {
  /** Positive penalty magnitude for a wrong MCQ, keyed by the item's marks. */
  mcq_negative: Record<string, number>;
  /** Divisor for MCQ mark values not in `mcq_negative` (penalty = marks / divisor). */
  mcq_negative_fallback_divisor: number;
  /** Penalty for a wrong MSQ. 0 for exams without MSQ negative marking. */
  msq_negative: number;
  /** Whether MSQ gives partial credit. The scorer refuses `true` (not implemented). */
  msq_partial_credit: boolean;
  /** Penalty for a wrong NAT. */
  nat_negative: number;
  /** Boundary tolerance applied to both ends of a NAT range. */
  nat_epsilon: number;
}

function num(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new BrainError('InvalidMarking', `${k} must be a finite number >= 0`);
  }
  return v;
}

/** Validate a parsed `exam.yaml` marking block. Throws InvalidMarking. */
export function parseExamMarking(raw: unknown): ExamMarking {
  if (!raw || typeof raw !== 'object') throw new BrainError('InvalidMarking', 'marking block missing');
  const o = raw as Record<string, unknown>;
  const neg = o.mcq_negative;
  if (!neg || typeof neg !== 'object') throw new BrainError('InvalidMarking', 'mcq_negative missing');
  const mcq_negative: Record<string, number> = {};
  for (const [k, v] of Object.entries(neg as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new BrainError('InvalidMarking', `mcq_negative.${k} must be a finite number >= 0`);
    }
    mcq_negative[k] = v;
  }
  const divisor = num(o, 'mcq_negative_fallback_divisor');
  if (divisor === 0) throw new BrainError('InvalidMarking', 'mcq_negative_fallback_divisor must be > 0');
  if (typeof o.msq_partial_credit !== 'boolean') {
    throw new BrainError('InvalidMarking', 'msq_partial_credit must be true or false');
  }
  return {
    mcq_negative,
    mcq_negative_fallback_divisor: divisor,
    msq_negative: num(o, 'msq_negative'),
    msq_partial_credit: o.msq_partial_credit,
    nat_negative: num(o, 'nat_negative'),
    nat_epsilon: num(o, 'nat_epsilon'),
  };
}
