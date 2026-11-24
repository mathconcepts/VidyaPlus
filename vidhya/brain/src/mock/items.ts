/**
 * Item adapters for the mock: Item (pack) -> ScorableItem (the one scorer), and
 * the student-safe view of an item. The view is built field by field from an
 * allow-list so a new Item field can never leak by default (R15, DR11).
 */
import { BrainError } from '../errors.js';
import { fingerprint, gradingFp, type Item } from '../item/schema.js';
import type { ScorableItem } from '../scoring/scorer.js';

export function toScorable(item: Item): ScorableItem {
  switch (item.type) {
    case 'MCQ':
      if (typeof item.key !== 'number' || !item.options?.length) throw new BrainError('InvalidItem', `mock item ${item.id}: MCQ needs a numeric key and options`);
      return { id: item.id, kind: 'mcq', marks: item.marks, answerIndex: item.key, options: item.options };
    case 'MSQ':
      if (!Array.isArray(item.key) || !item.key.length || !item.options?.length) throw new BrainError('InvalidItem', `mock item ${item.id}: MSQ needs key indices and options`);
      return { id: item.id, kind: 'msq', marks: item.marks, answerIndices: item.key, options: item.options };
    case 'NAT':
      if (!item.nat_range) throw new BrainError('InvalidItem', `mock item ${item.id}: NAT needs nat_range`);
      return { id: item.id, kind: 'nat', marks: item.marks, answerRange: item.nat_range };
  }
}

export interface FrozenItem {
  item_id: string;
  fingerprint: string;
  grading_fp: string;
  marks: number;
}

export function freeze(item: Item): FrozenItem {
  return { item_id: item.id, fingerprint: fingerprint(item), grading_fp: gradingFp(item), marks: item.marks };
}

export interface StudentItemView {
  item_id: string;
  position: number;
  type?: Item['type'];
  marks: number;
  stem?: string;
  options?: string[];
  /** The item is no longer in the pack; it stays in the attempt and is not counted. */
  unavailable?: true;
}

export function studentItemView(frozen: FrozenItem, position: number, item: Item | undefined): StudentItemView {
  if (!item) return { item_id: frozen.item_id, position, marks: frozen.marks, unavailable: true };
  const v: StudentItemView = { item_id: item.id, position, type: item.type, marks: item.marks, stem: item.stem };
  if (item.options) v.options = [...item.options];
  return v;
}
