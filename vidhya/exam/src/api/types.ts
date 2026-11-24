/**
 * The contract between the /exam app and the Exam Brain (plan section 21, T25).
 * The app only ever talks to an `ExamApi`. `FakeExamApi` (synthetic data) is the
 * only implementation today; real HTTP comes later behind the same interface.
 *
 * Rules the types enforce:
 *  - Nothing key-shaped (answer keys, topic rows of a mock) is part of any
 *    type returned before a mock closes (DR11, T29).
 *  - Receipts arrive as verification RECORDS, never as a "verified" boolean.
 *    The UI mints a Receipt only via `receiptFromItemRecord` in @vidhya/ui,
 *    which needs the record's fingerprint to equal the item's (plan rule 6).
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

export interface MarksView {
  range: { low: number; high: number; of: number } | null;
  basis: string;
  lastWeek: string | null;
  lost: { label: string; marks: number }[];
}

export type ReportContext = 'item' | 'mock';

export interface ExamApi {
  getToday(): Promise<TodayPlan>;
  listTopics(): Promise<TopicRow[]>;
  topicItems(topicId: string): Promise<TodayItemRef[]>;
  getItem(itemId: string): Promise<ExamItem>;
  checkAnswer(itemId: string, answer: Answer): Promise<CheckOutcome>;
  /** Results of answers that were queued offline arrive here once the network returns. */
  onQueuedResult(listener: (r: CheckResult) => void): () => void;

  getMockBrief(): Promise<MockBrief>;
  startMock(): Promise<MockAttempt>;
  answerMock(attemptId: string, itemId: string, answer: Answer | null, flagged: boolean): Promise<void>;
  submitMock(attemptId: string): Promise<void>;
  /** Before close: score and tally only (DR11). */
  getMockResult(attemptId: string): Promise<MockResultPreClose>;
  /** After close, takers only (DR6). */
  getMockReview(): Promise<MockReviewRow[]>;

  getMarks(): Promise<MarksView>;
  report(itemId: string, note: string, context: ReportContext): Promise<void>;
}
