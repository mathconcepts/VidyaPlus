/**
 * The one NAT parser (plan §22, E4). The brain grades with it and the /exam
 * keypad uses it for "Reads as", so the value a student sees is the value
 * that gets graded. No imports: both the brain and the browser load it.
 *
 * Accepts "2.45", "-0.5", "1e-3", ".5", "3." and surrounding spaces.
 * Refuses "2,45", "1/3", "abc", empty input and anything over 64 characters.
 */
const NAT_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export const NAT_PARSE_HINT = 'enter a number, e.g. 2.45';

export type NatParse = { ok: true; value: number } | { ok: false; hint: string };

export function tryParseNat(raw: string): NatParse {
  const s = raw.trim();
  if (s.length === 0 || s.length > 64 || !NAT_PATTERN.test(s)) return { ok: false, hint: NAT_PARSE_HINT };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, hint: NAT_PARSE_HINT };
  return { ok: true, value: v };
}
