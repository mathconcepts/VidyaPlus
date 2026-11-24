/**
 * receipt — the only place a Receipt may be created.
 *
 * DESIGN-SYSTEM.md: "The receipt border is a promise, not a style. Only
 * `<ReceiptBorder receipt={...}>` may render it, and only with a real receipt
 * object." That law had a hole: `{ verified: true }` is a syntactically valid
 * receipt object, so any call site could mint the promise out of nothing and
 * the type system would wave it through.
 *
 * It did. `SpinePage` drew the border whenever a topic had at least one
 * spaced-repetition attempt, and labelled it "verified attempts" — but
 * `sr_sessions.attempts` / `correct_count` are self-reported recall counts
 * (`gate-routes.ts` handleGetProgress). Nothing verified them. Seed a persona
 * with attempts and the border appears, asserting "this is proven true" over
 * numbers no system ever checked. In front of someone auditing whether the
 * product lies, that is the exact thing they are looking for.
 *
 * Two changes close it:
 *   1. `source` is REQUIRED. A receipt must name what attests it, so
 *      `{ verified: true }` no longer type-checks.
 *   2. Receipts are built by the constructors below, from a backing record.
 *      Each returns `null` when the record does not actually attest the
 *      content, and `<ReceiptBorder receipt={null}>` renders the children
 *      with no border — the honest default.
 *
 * The invariant is enforced in CI by `receipt.invariant.test.ts`, which fails
 * on a receipt literal written anywhere outside this module.
 */

/**
 * Proof that a piece of content is backed by a real verification record.
 * Construct via the helpers below — never as a literal.
 */
export interface Receipt {
  /** True only when the backing record attests this content. */
  verified: boolean;
  /** Required: names the system that attests it. Shown as "Verified · {source}". */
  source: string;
}

/**
 * Confidence floor for treating a tiered-verification result as attested.
 * Matches `CAS_TRUST_THRESHOLD` in `src/scoring/adapters/cas-checker.ts` — the
 * backend already refuses to trust a cascade result below this, and the border
 * must not make a stronger claim than the checker that produced it.
 */
export const RECEIPT_CONFIDENCE_FLOOR = 0.7;

/** Shape returned by the 3-tier verification pipeline (`verification_log`). */
export interface VerificationRecord {
  status: string;
  confidence: number;
  tierUsed?: string;
}

/**
 * Receipt for a result from the RAG → LLM → Wolfram cascade.
 *
 * Returns null for `partial` / `failed` / `inconclusive`, and for a `verified`
 * result whose confidence sits below the floor — a hedged verification is not
 * a proof, and the border does not do hedging.
 */
export function receiptFromVerification(
  record: VerificationRecord | null | undefined,
): Receipt | null {
  if (!record || record.status !== 'verified') return null;
  if (!Number.isFinite(record.confidence) || record.confidence < RECEIPT_CONFIDENCE_FLOOR) {
    return null;
  }
  return { verified: true, source: record.tierUsed || 'verification_pipeline' };
}

/**
 * Receipt for an answer graded server-side against a canonical key.
 *
 * This is a genuine backing: `GateDeterministicScorer` computes the mark on the
 * server from an answer key the client never receives, so the client cannot
 * have manufactured the result. Note it attests the GRADE, not whether the
 * student was right — a wrong answer still earns the border, because what the
 * border promises is "this mark is real", not "you did well".
 */
export function receiptFromServerGrade(
  grade: { max?: number } | null | undefined,
  opts?: { scorer?: string },
): Receipt | null {
  // A grade with no marks scale is not a grade — the server did not score it.
  if (!grade || typeof grade.max !== 'number' || !Number.isFinite(grade.max)) return null;
  return { verified: true, source: opts?.scorer || 'gate_deterministic_scorer' };
}

/**
 * A receipt that is being re-checked (DR9, plan section 21): one engine
 * disagreed, so the item is not verified but the student can still practise
 * it. It is a distinct type so `{ verified: false }` can never be rendered
 * with a border by accident. Only `receiptFromRecheck` mints one.
 */
export interface PendingReceipt {
  pending: true;
  /** What is being re-checked, shown after "Re-checking · ". */
  note: string;
}

export function isPendingReceipt(r: unknown): r is PendingReceipt {
  return !!r && typeof r === 'object' && (r as PendingReceipt).pending === true;
}

/** A pending receipt from the brain's re-check record. Null unless an item is actually under re-check. */
export function receiptFromRecheck(
  record: { status: string; note?: string } | null | undefined,
): PendingReceipt | null {
  if (!record || record.status !== 'rechecking') return null;
  return { pending: true, note: record.note || 'one engine disagreed. You can still practise it.' };
}

/**
 * A verified receipt for a published item (plan rule 6, "receipts never lie"):
 * the verification record must say `verified` AND its fingerprint must equal
 * the item's own fingerprint, so an edited item can never keep an old receipt.
 */
export interface ItemVerificationRecord {
  status: string;
  /** Human line, e.g. "SymPy + Wolfram agree · 20 Nov v1". */
  source: string;
  recordFingerprint: string;
}

export function receiptFromItemRecord(
  record: ItemVerificationRecord | null | undefined,
  itemFingerprint: string,
): Receipt | null {
  if (!record || record.status !== 'verified' || !record.source) return null;
  if (!itemFingerprint || record.recordFingerprint !== itemFingerprint) return null;
  return { verified: true, source: record.source };
}

/**
 * Explicitly no receipt. Use where a surface once claimed backing it never had,
 * so the absence reads as a decision in review rather than an oversight.
 */
export const NO_RECEIPT: Receipt | null = null;
