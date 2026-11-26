/** BrainError code -> HTTP status. Every code is listed, so a new code cannot silently become a 500. */
import { BrainError, type BrainErrorCode } from '../errors.js';
import type { ApiError } from '../../../shared/api-contract.js';

const STATUS: Record<BrainErrorCode, number> = {
  InvalidItem: 500, InvalidResponse: 400, NatParseError: 400, MsqPartialCreditUnsupported: 500, InvalidMarking: 500, SympyUnavailable: 503,
  SessionMissing: 401, AuthUpstreamUnavailable: 503, AuthContractBroken: 502, AuthDisabled: 503, UnknownStudent: 403,
  StoreSchemaMismatch: 503, SchemaBehind: 503, MigrationFailed: 500, InvalidItemId: 400, InvalidRegistryRow: 500, UnknownTier: 500,
  InvalidDispute: 400, InvalidMockForm: 500, InvalidMockRequest: 400, MockFormUnknown: 404, MockAlreadyScored: 409, MockLateSubmit: 409,
  MockAttemptClosed: 409, MockNotSubmitted: 409, MockNotResettable: 409, MockCloseTooEarly: 409, MockClosed: 409, MockItemNotInForm: 404,
  AttemptNotOwned: 403, AccessEnded: 403, FeatureNotEnabled: 403, MockItemRefused: 403, MockNotClosed: 409, ItemNotFound: 404, ItemNotServed: 409,
  OriginRejected: 403, UnsupportedMediaType: 415, RateLimited: 429, BadRequest: 400, NotFound: 404, MethodNotAllowed: 405, PayloadTooLarge: 413, RenderFailed: 503, RenderUnsafe: 503, RenderMissing: 503, InvalidMarksQuery: 400,
};

export function statusFor(code: BrainErrorCode): number {
  return STATUS[code];
}

/** The JSON error body. Unknown errors are a plain 500 with no detail. */
export function toApiError(e: unknown): { status: number; body: ApiError; code: string } {
  if (e instanceof BrainError) {
    return { status: statusFor(e.code), code: e.code, body: { code: e.code, message: e.message.slice(e.code.length + 2) } };
  }
  return { status: 500, code: 'Internal', body: { code: 'Internal', message: 'something went wrong on our side' } };
}
