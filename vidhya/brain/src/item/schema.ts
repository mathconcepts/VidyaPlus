/**
 * The ONE owner of the item schema, the two fingerprints and the servable
 * rule (plan §4 K2, R14, D1). Pack builder, sync, CLI and server import from
 * here; nothing else defines these.
 *
 *   grading_fp  = sha256(stem, options, key, nat_range, marks)  -> do past attempts still count?
 *   fingerprint = sha256(grading fields + solution text)         -> receipts; any change re-verifies
 */
import { createHash } from 'node:crypto';
import { BrainError } from '../errors.js';

export type Pool = 'practice' | 'mock' | 'diagnostic';
export type ItemType = 'MCQ' | 'MSQ' | 'NAT';
export type AnswerKind = 'number' | 'formula' | 'options';
export type ItemStatus = 'verified' | 'retired';

export interface Item {
  id: string;
  pool: Pool;
  type: ItemType;
  answer_kind: AnswerKind;
  marks: number;
  topic_id: string;
  concept_id: string;
  stem: string;
  nat_range?: [number, number];
  options?: string[];
  /** MCQ: option index; MSQ: indices; NAT: the value; formula: the expression. */
  key: number | number[] | string;
  solution: { text: string; final_value?: number | string; checked: boolean };
  receipt?: unknown;
  status: ItemStatus;
  since_version: string;
}

/** The overlay rows the brain keeps in `item_status` (plan §3). */
export interface OverlayRow {
  item_id: string;
  fingerprint: string;
  status: 'disputed' | 'quarantined';
  closed_at?: string | null;
}

/**
 * Whitespace + simple LaTeX normalisation so trivial spacing edits never change
 * a hash. Whitespace runs collapse to one space; a space survives only between
 * two alphanumerics (so `\alpha x` stays distinct from `\alphax`). LaTeX spacing
 * commands (`\,` `\;` `\:` `\!` `\ ` `\quad` `\qquad`) are dropped.
 */
export function normaliseForFingerprint(text: string): string {
  let s = text.normalize('NFC');
  s = s.replace(/\\(?:,|;|:|!|quad\b|qquad\b)/g, ' ').replace(/\\ /g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.replace(/(.) (?=(.))/g, (m, a: string, b: string) =>
    /[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b) ? m : a,
  );
}

function normKey(key: Item['key']): unknown {
  if (Array.isArray(key)) return [...key].sort((a, b) => a - b);
  return typeof key === 'string' ? normaliseForFingerprint(key) : key;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function gradingFields(item: Item): unknown[] {
  return [
    normaliseForFingerprint(item.stem),
    (item.options ?? []).map(normaliseForFingerprint),
    normKey(item.key),
    item.nat_range ?? null,
    item.marks,
  ];
}

export function gradingFp(item: Item): string {
  return sha256(JSON.stringify(['grading', ...gradingFields(item)]));
}

export function fingerprint(item: Item): string {
  return sha256(JSON.stringify(['full', ...gradingFields(item), normaliseForFingerprint(item.solution.text)]));
}

/** First 8 hex characters of a fingerprint. */
export function fp8(fp: string): string {
  if (!/^[0-9a-f]{8,}$/.test(fp)) throw new BrainError('InvalidItemId', `not a hex fingerprint: "${fp}"`);
  return fp.slice(0, 8);
}

const TAG = /^ledger:([A-Za-z0-9][A-Za-z0-9._-]*)@([0-9a-f]{8})$/;

export function ledgerTag(id: string, fp: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new BrainError('InvalidItemId', `bad item id "${id}"`);
  return `ledger:${id}@${fp8(fp)}`;
}

export function parseLedgerTag(tag: string): { id: string; fp8: string } {
  const m = TAG.exec(tag);
  if (!m) throw new BrainError('InvalidItemId', `not a ledger tag: "${tag}"`);
  return { id: m[1]!, fp8: m[2]! };
}

/** Servable = verified AND no open overlay row for this item at this fingerprint. */
export function isServable(item: Item, overlayRows: readonly OverlayRow[]): boolean {
  if (item.status !== 'verified') return false;
  const fp = fingerprint(item);
  return !overlayRows.some(
    (r) => r.item_id === item.id && r.fingerprint === fp && (r.status === 'disputed' || r.status === 'quarantined') && !r.closed_at,
  );
}
