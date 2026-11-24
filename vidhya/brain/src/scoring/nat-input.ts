/**
 * Parse what a student typed into a NAT box. Accepts "2.45", "-0.5", "1e-3",
 * ".5" and a trailing/leading space. Refuses "2,45", "1/3", "abc" and empty
 * input with NatParseError, so a typo is never counted as an attempt (plan §7).
 */
import { BrainError } from '../errors.js';

const NAT_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseNatInput(raw: string): number {
  const s = raw.trim();
  if (s.length === 0 || s.length > 64 || !NAT_PATTERN.test(s)) {
    throw new BrainError('NatParseError', 'enter a number, e.g. 2.45');
  }
  const v = Number(s);
  if (!Number.isFinite(v)) throw new BrainError('NatParseError', 'enter a number, e.g. 2.45');
  return v;
}
