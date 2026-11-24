/**
 * Named brain errors. The plan bans catch-alls: every handler maps a failure
 * to one of these names (CEO plan §7, §15 Section 2), and logs carry `code`.
 */

export type BrainErrorCode =
  | 'InvalidItem'
  | 'InvalidResponse'
  | 'NatParseError'
  | 'MsqPartialCreditUnsupported'
  | 'InvalidMarking'
  | 'SympyUnavailable'
  | 'SessionMissing'
  | 'AuthUpstreamUnavailable'
  | 'AuthContractBroken'
  | 'AuthDisabled'
  | 'UnknownStudent'
  | 'StoreSchemaMismatch'
  | 'SchemaBehind'
  | 'MigrationFailed'
  | 'InvalidItemId'
  | 'InvalidRegistryRow'
  | 'UnknownTier'
  | 'InvalidDispute'
  | 'InvalidMockForm'
  | 'InvalidMockRequest'
  | 'MockFormUnknown'
  | 'MockAlreadyScored'
  | 'MockLateSubmit'
  | 'MockAttemptClosed'
  | 'MockNotSubmitted'
  | 'MockNotResettable'
  | 'MockCloseTooEarly'
  | 'MockClosed'
  | 'MockItemNotInForm'
  | 'AttemptNotOwned'
  | 'AccessEnded';

export class BrainError extends Error {
  readonly code: BrainErrorCode;
  constructor(code: BrainErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BrainError';
    this.code = code;
  }
}

export function isBrainError(e: unknown, code?: BrainErrorCode): e is BrainError {
  return e instanceof BrainError && (code === undefined || e.code === code);
}
