/** Shared row types, constants and loaders for src/mock. No scoring and no policy here. */
import type Database from 'better-sqlite3';
import { BrainError } from '../errors.js';
import type { Item } from '../item/schema.js';
import type { ExamMarking } from '../exam/marking.js';
import type { TierTemplate } from '../registry/registry.js';
import type { FrozenItem } from './items.js';

export type Db = Database.Database;

/** E3 (plan section 22, overriding the older 10 s grace): late-sync window after the server deadline. */
export const LATE_SYNC_WINDOW_MS = 2 * 60 * 1000;

/** What the mock needs from the outside: the exam's marking and the pack's items. */
export interface MockContext {
  marking: ExamMarking;
  /** Tier template (tiers.yaml): `startAttempt` checks the `mock` flag of a NEW attempt against it. */
  tiers: TierTemplate;
  /** Current item content by id (the pack release). Undefined when the item left the pack. */
  resolveItem: (id: string) => Item | undefined;
}

export interface FormRow {
  form_version: string;
  minutes: number;
  total_marks: number;
  items_json: string;
  planned_close: string | null;
  registered_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

export interface MockRow {
  id: number;
  student_hash: string;
  form_version: string;
  state: 'in_progress' | 'scored' | 'practice_only';
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  score: number | null;
  result_json: string | null;
  minutes: number;
  items_json: string;
  submit_reason: 'submit' | 'auto' | null;
}

export function getForm(db: Db, formVersion: string): FormRow {
  const row = db.prepare('SELECT * FROM mock_forms WHERE form_version = ?').get(formVersion) as FormRow | undefined;
  if (!row) throw new BrainError('MockFormUnknown', `no mock form "${formVersion}"`);
  return row;
}

export function getMock(db: Db, id: number): MockRow | undefined {
  return db.prepare('SELECT * FROM mocks WHERE id = ?').get(id) as MockRow | undefined;
}

/** E7: an attempt that is not the session student's is refused; unknown ids look the same (no probing). */
export function loadOwned(db: Db, student: string, attemptId: number): MockRow {
  const row = typeof attemptId === 'number' ? getMock(db, attemptId) : undefined;
  if (!row || !student || row.student_hash !== student) {
    throw new BrainError('AttemptNotOwned', 'that attempt does not belong to the signed-in student');
  }
  return row;
}

export const frozenItems = (row: Pick<MockRow, 'items_json'>): FrozenItem[] => JSON.parse(row.items_json) as FrozenItem[];
export const isPractice = (row: Pick<MockRow, 'state'>): boolean => row.state === 'practice_only';
export const isFinished = (row: Pick<MockRow, 'submitted_at'>): boolean => row.submitted_at !== null;
export const deadlineMs = (row: Pick<MockRow, 'deadline_at'>): number => Date.parse(row.deadline_at);
/** End of the E3 window, exclusive: an answer is accepted while receivedAt < this, the attempt auto-closes at it. */
export const windowEndMs = (row: Pick<MockRow, 'deadline_at'>): number => deadlineMs(row) + LATE_SYNC_WINDOW_MS;
