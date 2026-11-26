/**
 * The one HTTP contract between the /exam app and the Exam Brain (plan section 3 B8, section 21, T25).
 * No imports: the brain (NodeNext) and the browser app (Vite) both load this file by path.
 *
 * Rules the types enforce:
 *  - Nothing key-shaped (answer keys, topic rows of a mock) is part of any type returned before
 *    a mock closes (DR11, T29).
 *  - Receipts arrive as verification RECORDS, never as a "verified" boolean. The UI mints a
 *    Receipt only via `receiptFromItemRecord` in @vidhya/ui, which needs the record's
 *    fingerprint to equal the item's (plan rule 6).
 *  - The student is never named in a request: identity is the dt_token cookie (R1, R7-1).
 */

export type ItemKind = 'mcq' | 'msq' | 'nat';

export interface ItemOption {
  key: string; // 'A' | 'B' | ...
  /** Pre-rendered, sanitised HTML (KaTeX + MathML, E5/E8). Never user input. */
  html: string;
}

/** The brain's verification state for one item. Withdrawn/locked have no receipt object. */
export type ItemVerification =
  | { state: 'verified'; source: string; recordFingerprint: string; engineLines: string[] }
  | { state: 'rechecking'; note?: string }
  | { state: 'withdrawn' }
  | { state: 'locked'; unlockOn: string };

export interface ExamItem {
  id: string; // e.g. 'gate-ec-017'
  topic: string;
  topicLabel: string;
  kind: ItemKind;
  marks: 1 | 2;
  /** '−⅓' for MCQ, '0' for MSQ and NAT. */
  negative: string;
  stemHtml: string;
  options?: ItemOption[];
  fingerprint: string;
  verification: ItemVerification;
  /** True for mock items: the tutor link is hidden until close (DR10). */
  inMock?: boolean;
}

export type Answer =
  | { kind: 'mcq'; key: string }
  | { kind: 'msq'; keys: string[] }
  | { kind: 'nat'; raw: string };

export interface CheckResult {
  itemId: string;
  outcome: 'correct' | 'wrong' | 'skipped';
  yours: string;
  key: string;
  reason: string;
  /**
   * `reason` pre-rendered (KaTeX + MathML, server-sanitised, E5/E8). Optional so an older brain or a
   * test double can omit it; the app falls back to the plain `reason`. The only other HTML in this
   * contract is `stemHtml` and `ItemOption.html`; the app sets innerHTML from these fields alone.
   */
  reasonHtml?: string;
  /** Marks scored on this item (can be negative on MCQ). */
  scored: number;
  /** Counted, never estimated (DR12). Present only on a correct answer. */
  week: { right: number; total: number; topicNoun: string } | null;
  verification: ItemVerification;
}

export type CheckOutcome =
  | { status: 'checked'; result: CheckResult }
  /** The device is offline: the answer is saved and will be checked on reconnect (DR5). */
  | { status: 'queued' };

export interface TodayItemRef {
  id: string;
  topicLabel: string;
  kind: ItemKind;
}

export interface TodayPlan {
  minutes: number;
  items: TodayItemRef[];
  topics: string[];
  /** Marks the plan's topics carry in GATE (DR4 headline, starter state). */
  gateWeightMarks: number;
  /** Present once the student has 30 attempts or took the mock. */
  estimate: { low: number; high: number; attempts: number } | null;
  mockLine: string;
  continueRow: { label: string; progress: string } | null;
  withdrawnCount: number;
  /** All of today's best items are cleared (empty state). */
  cleared: boolean;
}

export interface TopicRow {
  id: string;
  label: string;
  natCount: number;
}

export type MockPhase = 'before-open' | 'open' | 'closed';

export interface MockBrief {
  phase: MockPhase;
  /** Whether this student has a scored attempt. After close, takers see Review. */
  taken: 'none' | 'in-progress' | 'submitted';
  opensOn: string;
  closesOn: string;
  unlockOn: string;
  minutes: number;
  questions: number;
  totalMarks: number;
  rules: string[];
}

export interface MockItemLite {
  id: string;
  kind: ItemKind;
  marks: 1 | 2;
  negative: string;
  stemHtml: string;
  options?: ItemOption[];
}

export interface MockAttempt {
  attemptId: string;
  /** Server clock when this response was made, and the server deadline (ms since epoch). */
  serverNowMs: number;
  deadlineMs: number;
  items: MockItemLite[];
  saved: Record<string, { answer: Answer | null; flagged: boolean }>;
}

export interface MockResultPreClose {
  score: number;
  outOf: number;
  right: number;
  wrong: number;
  skipped: number;
  submittedOn: string;
  unlockOn: string;
}

export interface MockReviewRow {
  item: ExamItem;
  result: CheckResult;
}

/** One row of the mistake taxonomy (B5). UNCLASSIFIED is a real row, never hidden or guessed. */
export interface TaxonomyRow {
  bucket: 'TIME' | 'EXAMCRAFT' | 'CALC' | 'CONCEPT' | 'UNCLASSIFIED';
  label: string;
  /** Wrong answers in this bucket (counted, not marks). */
  wrong: number;
}

export interface MarksView {
  range: { low: number; high: number; of: number } | null;
  /** The basis line: "estimate from N attempts", or the needs-more message when `range` is null. */
  basis: string;
  lastWeek: string | null;
  /** Legacy marks-lost rows. The brain sends `taxonomy` instead and leaves this empty. */
  lost: { label: string; marks: number }[];
  /** Backward compatible additions (all optional). */
  status?: 'ok' | 'needs_more';
  /** Few attempts behind the range, so it is wide. */
  lowN?: boolean;
  attempts?: number;
  taxonomy?: TaxonomyRow[];
  /** Total wrong answers the taxonomy covers. */
  wrongTotal?: number;
  /** The scored mock's score, once the student has finished it. */
  score?: { score: number; outOf: number; label: string };
}

export type ReportContext = 'item' | 'mock';

// ---------------------------------------------------------------- /v1 wire shapes

/** Every error body, whatever the status. `code` is a BrainError code or a transport code. */
export interface ApiError {
  code: string;
  message: string;
}

export interface SessionInfo {
  /** Opaque id of the signed-in student. The offline queue tags entries with it (E7). */
  studentId: string;
  flags: { exam_page: boolean; nat: boolean; mock: boolean; today_card: boolean; disputes: boolean };
  /** False once `entitled_until` has passed: history stays readable, new work is refused (DR7). */
  entitled: boolean;
  /** Build id of the brain, so the app can show its refresh banner (E10). */
  buildId: string;
}

export interface HealthInfo {
  ok: boolean;
  pack_version: string | null;
  schema_version: number;
  db_writable: boolean;
  deeptutor_auth_reachable: boolean;
  mock_form: 'ready' | 'unavailable' | 'none';
  last_sync: string | null;
  build_id: string;
}

export interface CheckRequest {
  answer: Answer;
  /** Milliseconds the student spent on the item. */
  elapsedMs?: number;
  /** Per submission; a replay of the same key returns the same result and stores nothing new. */
  idempotencyKey?: string;
}

export interface MockAnswerRequest {
  itemId: string;
  /** null clears the answer (a skip). */
  answer: Answer | null;
  flagged: boolean;
  idempotencyKey: string;
  /** Client clock, ISO 8601. */
  enteredAt: string;
  /** The student id the offline queue tagged this entry with (E7). Must equal the signed-in student. */
  queueOwner: string;
}

export interface MockAnswerResponse {
  status: 'saved' | 'duplicate';
}

export interface MockAutosaveRequest {
  entries: MockAnswerRequest[];
}

export interface MockAutosaveResponse {
  results: { idempotencyKey: string; status: 'saved' | 'duplicate' | 'refused'; code?: string }[];
}

export interface MockSubmitResponse {
  attemptId: string;
  mode: 'scored' | 'practice';
  /** True when the server closed it at the window end rather than the student submitting. */
  autoClosed: boolean;
}

export interface ReportRequest {
  itemId: string;
  note: string;
  context: ReportContext;
}

export interface ReportResponse {
  ok: true;
  message: string;
}

// ---------------------------------------------------------------- routes

/** Route patterns. `:name` segments are path parameters. The brain's router and the client both read these. */
export const ROUTE_PATTERNS = {
  health: '/health',
  session: '/v1/session',
  login: '/v1/login',
  today: '/v1/today',
  topics: '/v1/topics',
  topicItems: '/v1/topics/:topicId/items',
  item: '/v1/items/:itemId',
  check: '/v1/items/:itemId/check',
  mockBrief: '/v1/mock',
  mockStart: '/v1/mock/attempts',
  mockState: '/v1/mock/attempts/:attemptId',
  mockAnswer: '/v1/mock/attempts/:attemptId/answers',
  mockAutosave: '/v1/mock/attempts/:attemptId/autosave',
  mockSubmit: '/v1/mock/attempts/:attemptId/submit',
  mockResult: '/v1/mock/attempts/:attemptId/result',
  mockReview: '/v1/mock/review',
  marks: '/v1/marks',
  report: '/v1/report',
} as const;

export type RouteName = keyof typeof ROUTE_PATTERNS;

/** Verb + pattern per route, the single source for server routing and the client. */
export const ROUTE_METHODS: Record<RouteName, 'GET' | 'POST'> = {
  health: 'GET', session: 'GET', login: 'GET', today: 'GET', topics: 'GET', topicItems: 'GET', item: 'GET', check: 'POST',
  mockBrief: 'GET', mockStart: 'POST', mockState: 'GET', mockAnswer: 'POST', mockAutosave: 'POST', mockSubmit: 'POST',
  mockResult: 'GET', mockReview: 'GET', marks: 'GET', report: 'POST',
};

/** Fill a pattern's `:params`, URL-encoding each value. */
export function routePath(name: RouteName, params: Record<string, string | number> = {}): string {
  return ROUTE_PATTERNS[name].replace(/:([A-Za-z]+)/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`route ${name} needs param ${k}`);
    return encodeURIComponent(String(v));
  });
}

/** E9: a return or redirect path is accepted only under /exam/; anything else becomes /exam/. */
export const EXAM_HOME = '/exam/';
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return EXAM_HOME;
  if (!raw.startsWith('/exam/')) return EXAM_HOME;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return EXAM_HOME;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return EXAM_HOME;
  }
  if (!decoded.startsWith('/exam/') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return EXAM_HOME;
  if (decoded.split(/[?#]/)[0]!.split('/').some((seg) => seg === '..' || seg === '.')) return EXAM_HOME;
  return raw;
}
