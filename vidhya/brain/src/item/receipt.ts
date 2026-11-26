/**
 * The verification record on an item. Allow-list parse: only method, engine names, agreement,
 * reviewer, review date and the fingerprint the record was made for survive. Values (the numbers
 * an engine produced) are dropped here, so nothing downstream can leak them (T4, X1).
 */
export interface ReceiptRecord {
  method: string;
  engines: string[];
  agree: boolean;
  reviewer: string | null;
  reviewed_at: string | null;
  /** The item fingerprint the record was made for (plan rule 6). */
  fingerprint: string | null;
}

export function parseReceipt(raw: unknown): ReceiptRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const engines = Array.isArray(o.engines)
    ? o.engines
        .map((e) => (typeof e === 'string' ? e : e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : null))
        .filter((e): e is string => e !== null)
    : [];
  if (engines.length === 0 || typeof o.agree !== 'boolean') return null;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    method: str(o.method) ?? 'two-engine check',
    engines,
    agree: o.agree,
    reviewer: str(o.reviewer),
    reviewed_at: str(o.reviewed_at),
    fingerprint: str(o.fingerprint),
  };
}
