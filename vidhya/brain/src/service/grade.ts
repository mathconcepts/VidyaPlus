/**
 * One place that turns a wire `Answer` into a scorer response, grades it, and formats what a
 * student may see afterwards. The /exam HTTP routes and the tutor MCP `check_answer` both call
 * this, so HTTP and MCP cannot grade differently.
 */
import { BrainError } from '../errors.js';
import type { Item } from '../item/schema.js';
import { describeMarking, scoreAttempt, type Grade, type StudentResponse } from '../scoring/scorer.js';
import { parseNatInput } from '../scoring/nat-input.js';
import { toScorable } from '../mock/items.js';
import type { ExamMarking } from '../exam/marking.js';
import type { Answer, ItemKind, ItemVerification } from '../../../shared/api-contract.js';
import { parseReceipt } from '../item/receipt.js';

const kindOf = (item: Item): ItemKind => item.type.toLowerCase() as ItemKind;
export const optionKey = (i: number): string => String.fromCharCode(65 + i);

function indexOfKey(k: unknown, count: number): number {
  if (typeof k !== 'string' || !/^[A-Z]$/.test(k)) throw new BrainError('InvalidResponse', 'an option is a single capital letter, e.g. "B"');
  const i = k.charCodeAt(0) - 65;
  if (i >= count) throw new BrainError('InvalidResponse', `option ${k} does not exist`);
  return i;
}

/** Validates the wire answer's shape and maps it to the scorer's response. Throws InvalidResponse / NatParseError. */
export function answerToResponse(item: Item, a: Answer | null | undefined): StudentResponse {
  if (!a || typeof a !== 'object') throw new BrainError('InvalidResponse', 'answer is required');
  const kind = kindOf(item);
  if (a.kind !== kind) throw new BrainError('InvalidResponse', `this item takes a ${kind} answer, got ${String((a as { kind?: unknown }).kind)}`);
  const n = item.options?.length ?? 0;
  switch (a.kind) {
    case 'mcq':
      return { kind: 'mcq', selectedIndex: indexOfKey(a.key, n) };
    case 'msq':
      if (!Array.isArray(a.keys) || a.keys.length === 0) throw new BrainError('InvalidResponse', 'msq needs at least one option');
      return { kind: 'msq', selectedIndices: a.keys.map((k) => indexOfKey(k, n)) };
    case 'nat':
      if (typeof a.raw !== 'string') throw new BrainError('InvalidResponse', 'nat needs the typed value');
      return { kind: 'nat', value: parseNatInput(a.raw) };
  }
}

export function gradeItem(item: Item, response: StudentResponse, marking: ExamMarking): Grade {
  return scoreAttempt(toScorable(item), response, marking);
}

/** The key as the student sees it AFTER an attempt. */
export function formatKey(item: Item): string {
  if (item.type === 'MCQ') return optionKey(item.key as number);
  if (item.type === 'MSQ') return (item.key as number[]).map(optionKey).join(', ');
  const [lo, hi] = item.nat_range ?? [NaN, NaN];
  return lo === hi ? String(lo) : `${lo} to ${hi}`;
}

export function formatYours(a: Answer): string {
  return a.kind === 'mcq' ? a.key : a.kind === 'msq' ? [...a.keys].sort().join(', ') : a.raw.trim();
}

const GLYPH: Record<string, string> = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/6': '⅙', '5/6': '⅚' };
/** '−⅓' for a wrong MCQ of 1 mark, '0' when nothing is deducted. */
export function formatNegative(item: Item, marking: ExamMarking): string {
  const wrong = Math.abs(describeMarking(toScorable(item), marking).marks_wrong);
  if (wrong === 0) return '0';
  for (const d of [2, 3, 4, 6]) {
    const num = Math.round(wrong * d);
    if (Math.abs(num / d - wrong) < 1e-9 && num % d !== 0) {
      const f = `${num}/${d}`;
      const g = GLYPH[reduce(num, d)];
      return `−${g ?? f}`;
    }
  }
  return `−${Number(wrong.toFixed(2))}`;
}
function reduce(n: number, d: number): string {
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const k = g(n, d);
  return `${n / k}/${d / k}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Plain text to safe HTML. KaTeX pre-render (E5/E8) is a later step; until then every stem and
 * option is escaped, so item content can never inject markup.
 */
export const textToHtml = (s: string): string => escapeHtml(s);

export function marksOf(item: Item): 1 | 2 {
  if (item.marks !== 1 && item.marks !== 2) throw new BrainError('InvalidItem', `item ${item.id} has ${item.marks} marks; the app shows 1 or 2`);
  return item.marks;
}

/** Verification as a RECORD (rule 6): never a bare "verified". The UI compares recordFingerprint to the item's. */
export function verificationOf(item: Item): ItemVerification {
  const r = parseReceipt(item.receipt);
  if (!r || !r.agree || !r.fingerprint) return { state: 'rechecking', note: 'No verification record yet.' };
  const bits = [r.method, r.reviewer ? `reviewed by ${r.reviewer}` : null, r.reviewed_at].filter((x): x is string => !!x);
  return { state: 'verified', source: bits.join(' · '), recordFingerprint: r.fingerprint, engineLines: r.engines };
}
