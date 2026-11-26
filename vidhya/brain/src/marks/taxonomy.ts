/**
 * B5 mistake taxonomy. A precedence list (plan section 15: no method over 5
 * branches), applied in order:
 *   1 TIME        unattempted when the mock timed out
 *   2 EXAMCRAFT   a wrong answer given in under 0.3 x the item's median time (a guess)
 *   3 CALC        chose a distractor tagged calc; or a wrong NAT value inside the near band
 *   4 CONCEPT     chose a distractor tagged concept; or a wrong NAT value outside the near band
 *   5 UNCLASSIFIED  anything else, shown as such and never guessed
 *
 * Tags live on the item as `distractor_tags`: option letter -> 'calc' | 'concept'
 * (plan section 4, K2 item fields). An item without them is UNCLASSIFIED for MCQ/MSQ.
 */
import type { Item } from '../item/schema.js';
import type { StudentResponse } from '../scoring/scorer.js';

export const BUCKETS = ['TIME', 'EXAMCRAFT', 'CALC', 'CONCEPT', 'UNCLASSIFIED'] as const;
export type Bucket = (typeof BUCKETS)[number];

export type DistractorTag = 'calc' | 'concept';
export type TaggedItem = Item & { distractor_tags?: Record<string, DistractorTag> };

/** A guess is faster than this share of the reference time. */
export const EXAMCRAFT_FRACTION = 0.3;
/** NAT near band: within this share of the key. */
export const NAT_NEAR_FRACTION = 0.1;
/** NAT near band when the key is 0: this many range half-widths. */
export const NAT_ZERO_HALF_WIDTHS = 3;

export interface WrongAttempt {
  item_id: string;
  topic_id: string;
  /** Null when the item left the pack. */
  item: TaggedItem | undefined;
  response: StudentResponse | null;
  /** The student left it blank and the mock timed out. */
  skipped_at_timeout: boolean;
  elapsed_ms: number | null;
  /** Median time for the item (B7, n >= 5) or a prior; null means unknown, so EXAMCRAFT cannot apply. */
  reference_ms: number | null;
}

const LETTERS = 'ABCDEFGH';
const letter = (i: number) => LETTERS[i] ?? String(i);

function natBand(item: TaggedItem, value: number): 'near' | 'far' | null {
  const key = Number(item.key);
  if (!Number.isFinite(key) || !Number.isFinite(value)) return null;
  const half = item.nat_range ? Math.abs(item.nat_range[1] - item.nat_range[0]) / 2 : 0;
  const tol = key === 0 ? NAT_ZERO_HALF_WIDTHS * half : NAT_NEAR_FRACTION * Math.abs(key);
  return Math.abs(value - key) <= tol ? 'near' : 'far';
}

function chosenWrongTags(item: TaggedItem, r: StudentResponse): DistractorTag[] {
  const tags = item.distractor_tags;
  if (!tags) return [];
  const keyed = new Set(Array.isArray(item.key) ? item.key : typeof item.key === 'number' ? [item.key] : []);
  const picked = r.kind === 'mcq' ? (r.selectedIndex === undefined ? [] : [r.selectedIndex]) : r.kind === 'msq' ? (r.selectedIndices ?? []) : [];
  return picked.filter((i) => !keyed.has(i)).flatMap((i) => (tags[letter(i)] ? [tags[letter(i)]!] : []));
}

type Rule = (w: WrongAttempt) => Bucket | null;

const RULES: readonly Rule[] = [
  (w) => (w.skipped_at_timeout ? 'TIME' : null),
  (w) =>
    w.elapsed_ms !== null && w.reference_ms !== null && w.reference_ms > 0 && w.response && !w.response.skipped && w.elapsed_ms < EXAMCRAFT_FRACTION * w.reference_ms
      ? 'EXAMCRAFT'
      : null,
  (w) => {
    if (!w.item || !w.response) return null;
    if (w.item.type === 'NAT') return w.response.kind === 'nat' && w.response.value !== undefined && natBand(w.item, w.response.value) === 'near' ? 'CALC' : null;
    return chosenWrongTags(w.item, w.response).includes('calc') ? 'CALC' : null;
  },
  (w) => {
    if (!w.item || !w.response) return null;
    if (w.item.type === 'NAT') return w.response.kind === 'nat' && w.response.value !== undefined && natBand(w.item, w.response.value) === 'far' ? 'CONCEPT' : null;
    return chosenWrongTags(w.item, w.response).includes('concept') ? 'CONCEPT' : null;
  },
];

export function classify(w: WrongAttempt): Bucket {
  for (const rule of RULES) {
    const b = rule(w);
    if (b) return b;
  }
  return 'UNCLASSIFIED';
}

export type BucketCounts = Record<Bucket, number>;
export const emptyCounts = (): BucketCounts => ({ TIME: 0, EXAMCRAFT: 0, CALC: 0, CONCEPT: 0, UNCLASSIFIED: 0 });

export interface Taxonomy {
  wrong_total: number;
  totals: BucketCounts;
  by_topic: Record<string, BucketCounts>;
  /** Share of wrong answers that got a real bucket (not UNCLASSIFIED), 0..1; null when there are none. */
  coverage: number | null;
}

export function aggregate(wrongs: readonly WrongAttempt[]): Taxonomy {
  const totals = emptyCounts();
  const by_topic: Record<string, BucketCounts> = {};
  for (const w of wrongs) {
    const b = classify(w);
    totals[b]++;
    (by_topic[w.topic_id] ??= emptyCounts())[b]++;
  }
  const n = wrongs.length;
  return { wrong_total: n, totals, by_topic, coverage: n === 0 ? null : (n - totals.UNCLASSIFIED) / n };
}
