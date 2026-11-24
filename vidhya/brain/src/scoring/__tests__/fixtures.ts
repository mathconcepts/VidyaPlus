import { parseExamMarking } from '../../exam/marking.js';

/** GATE-style marking as a pack's exam.yaml would state it (test data only). */
export const GATE_LIKE = parseExamMarking({
  mcq_negative: { '1': 1 / 3, '2': 2 / 3 },
  mcq_negative_fallback_divisor: 3,
  msq_negative: 0,
  msq_partial_credit: false,
  nat_negative: 0,
  nat_epsilon: 1e-9,
});
