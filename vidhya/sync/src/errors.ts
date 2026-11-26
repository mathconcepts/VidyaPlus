/** Named sync errors (plan §7: no catch-alls). The applier uses the same names. */
export type SyncErrorCode =
  | 'SyncAlreadyRunning'
  | 'SyncLockTimeout'
  | 'SyncMassRemoveRefused'
  | 'SyncPartialFailure'
  | 'SyncDrift'
  | 'StoreSchemaMismatch'
  | 'BrainUnavailable'
  | 'ServableContractBroken'
  | 'PackVersionMismatch'
  | 'UnknownStudent'
  | 'InvalidStudent'
  | 'ApplierFailed'
  | 'InvalidRow'
  | 'InvalidRequest';

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  constructor(code: SyncErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SyncError';
    this.code = code;
  }
}

export function isSyncError(e: unknown, code?: SyncErrorCode): e is SyncError {
  return e instanceof SyncError && (code === undefined || e.code === code);
}

/** Process exit codes of the CLI; the applier's own run-level codes map onto the same names. */
export const EXIT: Record<string, number> = {
  ok: 0,
  studentFailed: 1,
  SyncAlreadyRunning: 3,
  StoreSchemaMismatch: 4,
  other: 5,
  BrainUnavailable: 6,
  SyncMassRemoveRefused: 7,
  SyncDrift: 8,
};
