/**
 * The pack the brain serves from: a release directory with `items.jsonl` and `exam.json`.
 * (`exam.json` is what the pack build writes from `exam.yaml`, so the brain needs no YAML parser.)
 * The brain never imports pack code; it reads this artifact only (plan section 3, Ownership).
 *
 * exam.json: { version, marking, timing, topics: [{id, label, weight_marks}],
 *              tiers: { <tier>: {flags} }, mock?: { form_version, opens_on, closes_on, planned_close },
 *              section_marks?: number }
 *
 * `section_marks` is the marks the exam section carries (the "of N" under the marks range). It must be a
 * positive finite number. When absent it defaults to the sum of the topics' `weight_marks` (the pack's own
 * statement of what the section is worth); when that is also 0 the pack has no section marks and
 * /v1/marks says so instead of guessing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BrainError } from '../errors.js';
import { parseExamMarking, type ExamMarking } from '../exam/marking.js';
import { parseExamTiming, type ExamTiming } from '../mock/timing.js';
import type { Item } from '../item/schema.js';
import type { TierTemplate } from '../registry/registry.js';

export interface Topic {
  id: string;
  label: string;
  /** Marks the topic carries in the exam. */
  weight_marks: number;
}

export interface MockConfig {
  form_version: string;
  opens_on: string;
  closes_on: string;
  planned_close: string;
}

export interface Pack {
  version: string;
  marking: ExamMarking;
  timing: ExamTiming;
  topics: Topic[];
  tiers: TierTemplate;
  mock: MockConfig | null;
  /** Marks the exam section carries; null when the pack states none (see header). */
  section_marks: number | null;
  items: Item[];
  byId: Map<string, Item>;
}

const POOLS = ['practice', 'mock', 'diagnostic'];
const TYPES = ['MCQ', 'MSQ', 'NAT'];

export function parseItem(raw: unknown, where: string): Item {
  const o = raw as Record<string, unknown> | null;
  const bad = (m: string) => new BrainError('InvalidItem', `${where}: ${m}`);
  if (!o || typeof o !== 'object') throw bad('not an object');
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.id)) throw bad('bad id');
  if (!POOLS.includes(o.pool as string)) throw bad('bad pool');
  if (!TYPES.includes(o.type as string)) throw bad('bad type');
  if (typeof o.marks !== 'number' || !(o.marks > 0)) throw bad('bad marks');
  if (typeof o.stem !== 'string' || typeof o.topic_id !== 'string' || typeof o.concept_id !== 'string') throw bad('stem, topic_id and concept_id are required');
  if (o.status !== 'verified' && o.status !== 'retired') throw bad('bad status');
  const sol = o.solution as { text?: unknown } | undefined;
  if (!sol || typeof sol.text !== 'string') throw bad('solution.text is required');
  return o as unknown as Item;
}

/** Positive finite number, else the topics' weight sum, else null. A wrong type or sign is an error, never a silent default. */
export function parseSectionMarks(raw: unknown, topics: readonly Topic[]): number | null {
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) throw new BrainError('InvalidItem', 'exam.json section_marks must be a positive number');
    return raw;
  }
  const sum = topics.reduce((a, t) => a + (Number.isFinite(t.weight_marks) ? t.weight_marks : 0), 0);
  return sum > 0 ? sum : null;
}

export function buildPack(input: {
  version: string; marking: unknown; timing: unknown; topics: Topic[]; tiers: TierTemplate; mock?: MockConfig | null; section_marks?: unknown; items: unknown[];
}): Pack {
  const items = input.items.map((r, i) => parseItem(r, `item #${i + 1}`));
  const byId = new Map<string, Item>();
  for (const it of items) {
    if (byId.has(it.id)) throw new BrainError('InvalidItem', `duplicate item id ${it.id}`);
    byId.set(it.id, it);
  }
  return {
    version: input.version,
    section_marks: parseSectionMarks(input.section_marks, input.topics),
    marking: parseExamMarking(input.marking),
    timing: parseExamTiming(input.timing),
    topics: input.topics,
    tiers: input.tiers,
    mock: input.mock ?? null,
    items,
    byId,
  };
}

export function loadPack(dir: string): Pack {
  const exam = JSON.parse(readFileSync(path.join(dir, 'exam.json'), 'utf8')) as Record<string, unknown>;
  const lines = readFileSync(path.join(dir, 'items.jsonl'), 'utf8').split('\n').filter((l) => l.trim().length > 0);
  if (typeof exam.version !== 'string') throw new BrainError('InvalidItem', 'exam.json has no version');
  return buildPack({
    version: exam.version,
    marking: exam.marking,
    timing: exam.timing,
    topics: (exam.topics ?? []) as Topic[],
    tiers: (exam.tiers ?? {}) as TierTemplate,
    mock: (exam.mock ?? null) as MockConfig | null,
    section_marks: exam.section_marks,
    items: lines.map((l) => JSON.parse(l) as unknown),
  });
}
