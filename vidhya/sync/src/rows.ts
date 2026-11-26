/**
 * Item -> finished DeepTutor row (D1). The tag comes from the brain's one
 * schema module; the applier gets it as a string and never recomputes it.
 */
import { BrainError } from '../../brain/src/errors.js';
import { fingerprint, ledgerTag, type Item } from '../../brain/src/item/schema.js';
import type { SyncRow } from './types.js';

const LETTERS = 'ABCDEFGHIJ';

/** Every synced stem ends with its ledger id so a student can report it by id (plan X1). */
export function stemWithId(stem: string, id: string): string {
  const suffix = `[#${id}]`;
  const trimmed = stem.trimEnd();
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}\n\n${suffix}`;
}

export function itemToRow(item: Item): SyncRow {
  if (item.pool !== 'practice') throw new BrainError('InvalidItem', `${item.id}: only practice-pool items sync (got ${item.pool})`);
  if (item.type !== 'MCQ' && item.type !== 'MSQ') throw new BrainError('InvalidItem', `${item.id}: ${item.type} items are served by the brain, not synced`);
  const options = item.options ?? [];
  if (options.length < 2 || options.length > LETTERS.length) {
    throw new BrainError('InvalidItem', `${item.id}: needs 2-${LETTERS.length} options, has ${options.length}`);
  }
  const map: Record<string, string> = {};
  options.forEach((o, i) => {
    map[LETTERS[i]!] = o;
  });
  const idx = (k: unknown): string => {
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k >= options.length) {
      throw new BrainError('InvalidItem', `${item.id}: key ${String(k)} is not an option index`);
    }
    return LETTERS[k]!;
  };
  let answer: string;
  if (item.type === 'MCQ') {
    if (Array.isArray(item.key)) throw new BrainError('InvalidItem', `${item.id}: MCQ key must be one index`);
    answer = idx(item.key);
  } else {
    if (!Array.isArray(item.key) || new Set(item.key).size < 2) throw new BrainError('InvalidItem', `${item.id}: MSQ key needs at least 2 distinct indices`);
    answer = [...new Set(item.key.map(idx))].sort().join(',');
  }
  return {
    id: item.id,
    tag: ledgerTag(item.id, fingerprint(item)),
    question: stemWithId(item.stem, item.id),
    question_type: item.type === 'MCQ' ? 'single_choice' : 'multi_choice',
    options: map,
    correct_answer: answer,
    explanation: item.solution.text,
    difficulty: '',
    tags: [item.topic_id, item.concept_id].filter((t) => t && t.length > 0),
  };
}

export function itemsToRows(items: readonly Item[]): SyncRow[] {
  const seen = new Set<string>();
  const rows = items.map((i) => {
    if (seen.has(i.id)) throw new BrainError('InvalidItem', `duplicate item id ${i.id} in the servable set`);
    seen.add(i.id);
    return itemToRow(i);
  });
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
}
