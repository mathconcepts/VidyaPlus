/**
 * Brain wrapper over the shared NAT parser (vidhya/shared/nat-input.ts, E4).
 * A typo is never counted as an attempt: invalid input raises NatParseError (plan §7).
 */
import { BrainError } from '../errors.js';
import { tryParseNat } from '../../../shared/nat-input.js';

export function parseNatInput(raw: string): number {
  const r = tryParseNat(raw);
  if (!r.ok) throw new BrainError('NatParseError', r.hint);
  return r.value;
}
