/**
 * `vidhya sync` orchestration (plan §4 S-sync, S-drift, D1).
 *
 *   brain /v1/servable -> finished rows -> applier (inside DeepTutor, flock, one
 *   BEGIN IMMEDIATE per student) -> drift check (a dry run: nothing left to do).
 *
 * This module owns no DeepTutor knowledge. The servable source and the applier
 * runner are interfaces, so tests use fixtures and the HTTP server is built elsewhere.
 */
import { EXIT, SyncError, type SyncErrorCode } from './errors.js';
import { itemsToRows } from './rows.js';
import type {
  ApplierRequest,
  ApplierResponse,
  ApplierRunner,
  ApplierStudentResult,
  ServableSource,
  StudentRef,
  SyncRow,
  UpdateMode,
} from './types.js';

export const PINNED_DEEPTUTOR = '1.7.3';

export interface SyncOptions {
  students: readonly StudentRef[];
  /** `--student`: restrict to one DeepTutor user id or student hash. */
  only?: string;
  /** `--to <version>` */
  to?: string;
  dryRun?: boolean;
  allowMassRemove?: boolean;
  updateMode?: UpdateMode;
  dataRoot?: string;
  eventsPath?: string;
  lockPath?: string;
  expectedVersion?: string;
}

export interface SyncDeps {
  servable: ServableSource;
  applier: ApplierRunner;
}

export interface StudentReport extends ApplierStudentResult {
  drift?: number;
}

export interface SyncReport {
  ok: boolean;
  exitCode: number;
  packVersion: string;
  servableCount: number;
  dryRun: boolean;
  updateMode: UpdateMode;
  students: StudentReport[];
  /** Total drift after the run (S-drift); 0 is the only passing value. */
  drift: number;
  error?: { code: string; message: string };
}

const KNOWN_RUN_CODES = new Set<SyncErrorCode>([
  'SyncAlreadyRunning',
  'StoreSchemaMismatch',
  'SyncMassRemoveRefused',
  'InvalidStudent',
  'InvalidRow',
  'InvalidRequest',
]);

function runLevelError(body: ApplierResponse, code: number): SyncError {
  const c = body.error?.code as SyncErrorCode | undefined;
  return new SyncError(c && KNOWN_RUN_CODES.has(c) ? c : 'ApplierFailed', body.error?.message ?? `applier exited ${code}`);
}

export function selectStudents(all: readonly StudentRef[], only?: string): StudentRef[] {
  if (!only) return [...all];
  const hit = all.filter((s) => s.dtUserId === only || s.student === only || s.student.startsWith(only));
  if (hit.length === 0) throw new SyncError('UnknownStudent', `--student ${only} is not an enrolled student`);
  if (hit.length > 1) throw new SyncError('UnknownStudent', `--student ${only} matches ${hit.length} students; give more characters`);
  return hit;
}

export async function runSync(opts: SyncOptions, deps: SyncDeps): Promise<SyncReport> {
  const updateMode = opts.updateMode ?? 'in-place';
  const dryRun = opts.dryRun === true;
  const targets = selectStudents(opts.students, opts.only);

  // Brain down -> abort before any change.
  const servable = await deps.servable.fetch({ pool: 'practice', types: ['MCQ', 'MSQ'], version: opts.to });
  if (opts.to && servable.packVersion !== opts.to) {
    throw new SyncError('PackVersionMismatch', `--to ${opts.to}, but the brain serves pack ${servable.packVersion}`);
  }
  // An empty servable set is a brain glitch until proven otherwise: never delete everything.
  if (servable.items.length === 0 && !opts.allowMassRemove) {
    throw new SyncError('SyncMassRemoveRefused', 'the servable set is empty; refusing to empty every bank (use --allow-mass-remove)');
  }
  const rows: SyncRow[] = itemsToRows(servable.items);

  const base: Omit<ApplierRequest, 'mode'> = {
    data_root: opts.dataRoot,
    expected_version: opts.expectedVersion ?? PINNED_DEEPTUTOR,
    events_path: opts.eventsPath,
    lock_path: opts.lockPath,
    update_mode: updateMode,
    allow_mass_remove: opts.allowMassRemove === true,
    students: targets.map((s) => ({ student: s.student, dt_user_id: s.dtUserId, rows })),
  };

  const first = await deps.applier.run({ ...base, mode: dryRun ? 'dry-run' : 'apply' });
  if (first.body.error || !first.body.students) throw runLevelError(first.body, first.code);
  const reports: StudentReport[] = first.body.students.map((s) => ({ ...s }));

  let drift = 0;
  if (!dryRun) {
    // S-drift: after the run, a dry run must find nothing left to insert, update or remove.
    const check = await deps.applier.run({ ...base, mode: 'dry-run', allow_mass_remove: true });
    if (check.body.error || !check.body.students) throw runLevelError(check.body, check.code);
    for (const c of check.body.students) {
      const d = (c.plan_insert ?? 0) + (c.plan_update ?? 0) + (c.plan_remove ?? 0);
      const r = reports.find((x) => x.student === c.student);
      if (r) r.drift = d;
      drift += d;
    }
  }

  const anyFailed = reports.some((r) => r.status === 'failed' || r.status === 'skipped');
  const exitCode = anyFailed ? EXIT.studentFailed! : drift > 0 ? EXIT.SyncDrift! : EXIT.ok!;
  return {
    ok: exitCode === 0,
    exitCode,
    packVersion: servable.packVersion,
    servableCount: rows.length,
    dryRun,
    updateMode,
    students: reports,
    drift,
  };
}

export function exitCodeFor(e: unknown): number {
  if (e instanceof SyncError) return EXIT[e.code] ?? EXIT.other!;
  return EXIT.other!;
}
