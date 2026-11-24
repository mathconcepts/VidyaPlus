/**
 * R23 / X4: the registry (hashed ids, tier, entitled_until) and the per-student
 * flags derived from a tier template. Payment is out of scope: Giri sets
 * `entitled_until` by CLI after a payment.
 *
 * DR7: when access has ended, history stays readable (exam_page) while every
 * new-work flag turns off. A null `entitled_until` means no access was ever
 * granted, so it is treated as not entitled.
 */
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { BrainError } from '../errors.js';

type Db = Database.Database;

export interface Flags {
  exam_page: boolean;
  nat: boolean;
  mock: boolean;
  today_card: boolean;
  disputes: boolean;
  tutor_mcp: boolean;
}
export const FLAG_NAMES = ['exam_page', 'nat', 'mock', 'today_card', 'disputes', 'tutor_mcp'] as const;
/** Flags that start new work; these go off when entitlement ends. exam_page stays on for history. */
export const NEW_WORK_FLAGS = ['nat', 'mock', 'today_card', 'disputes', 'tutor_mcp'] as const;

/** A parsed tiers.yaml: tier name -> flags. */
export type TierTemplate = Readonly<Record<string, Readonly<Flags>>>;

export interface RegistryRow {
  student_hash: string;
  dt_user_hash: string;
  tier: string;
  entitled_until: string | null; // YYYY-MM-DD, inclusive
}

/** Salted sha256 of a raw id (Telegram or DeepTutor). Raw ids are never stored. */
export function hashId(raw: string, salt: string): string {
  if (!raw || !salt) throw new BrainError('InvalidRegistryRow', 'hashId needs a non-empty id and salt');
  return createHash('sha256').update(`${salt}:${raw}`, 'utf8').digest('hex');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(d: string): void {
  if (!DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    throw new BrainError('InvalidRegistryRow', `entitled_until must be a real YYYY-MM-DD date, got "${d}"`);
  }
}

export function upsertStudent(db: Db, row: RegistryRow, now: Date): void {
  if (!/^[0-9a-f]{64}$/.test(row.student_hash) || !/^[0-9a-f]{64}$/.test(row.dt_user_hash)) {
    throw new BrainError('InvalidRegistryRow', 'student_hash and dt_user_hash must be sha256 hex (never raw ids)');
  }
  if (!row.tier) throw new BrainError('InvalidRegistryRow', 'tier is required');
  if (row.entitled_until !== null) assertDate(row.entitled_until);
  const ts = now.toISOString();
  db.prepare(
    `INSERT INTO registry (student_hash, dt_user_hash, tier, entitled_until, created_at, updated_at)
     VALUES (@student_hash, @dt_user_hash, @tier, @entitled_until, @ts, @ts)
     ON CONFLICT (student_hash) DO UPDATE SET dt_user_hash = excluded.dt_user_hash, tier = excluded.tier,
       entitled_until = excluded.entitled_until, updated_at = excluded.updated_at`,
  ).run({ ...row, ts });
}

export function getStudent(db: Db, studentHash: string): RegistryRow {
  const row = db
    .prepare('SELECT student_hash, dt_user_hash, tier, entitled_until FROM registry WHERE student_hash = ?')
    .get(studentHash) as RegistryRow | undefined;
  if (!row) throw new BrainError('UnknownStudent', 'no registry row for this student');
  return row;
}

/** Entitled through the end of `entitled_until` (UTC), inclusive. */
export function entitledAt(row: Pick<RegistryRow, 'entitled_until'>, now: Date): boolean {
  if (row.entitled_until === null) return false;
  return now.toISOString().slice(0, 10) <= row.entitled_until;
}

export function isEntitled(db: Db, studentHash: string, now: Date): boolean {
  return entitledAt(getStudent(db, studentHash), now);
}

export function flagsFor(student: RegistryRow, now: Date, tierTemplate: TierTemplate): Flags {
  const base = tierTemplate[student.tier];
  if (!base) throw new BrainError('UnknownTier', `tier "${student.tier}" is not in the tier template`);
  for (const f of FLAG_NAMES) {
    if (typeof base[f] !== 'boolean') throw new BrainError('UnknownTier', `tier "${student.tier}" has no boolean flag "${f}"`);
  }
  const flags: Flags = { ...base };
  if (!entitledAt(student, now)) for (const f of NEW_WORK_FLAGS) flags[f] = false;
  return flags;
}
