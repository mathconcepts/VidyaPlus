/** The no-leak walker from src/mock, applied to HTTP bodies: forbidden field names anywhere, and sentinel strings in any value or key. */
export const FORBIDDEN_KEY = /^(answer_?index(es|ices)?|answer_?range|nat_range|solution|receipt|topic.*|concept.*|fingerprint|grading_fp|verification)$/i;
// `key` is not listed: an option letter field is called `key` in the contract (ItemOption). Item shapes are pinned by exact-shape tests instead.

export function leaks(value: unknown, sentinels: string[], trail = '$', seen = new Set<unknown>()): string[] {
  const out: string[] = [];
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') for (const s of sentinels) if (value.includes(s)) out.push(`${trail} contains ${s}`);
    return out;
  }
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...leaks(v, sentinels, `${trail}[${i}]`, seen)));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(k)) out.push(`${trail}.${k} is a forbidden field`);
    for (const s of sentinels) if (k.includes(s)) out.push(`${trail} key name contains ${s}`);
    out.push(...leaks(v, sentinels, `${trail}.${k}`, seen));
  }
  return out;
}
