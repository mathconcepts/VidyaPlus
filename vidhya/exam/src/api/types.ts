/**
 * The /exam app's view of the Exam Brain (plan section 21, T25). The data types and the /v1
 * route table live in `vidhya/shared/api-contract.ts`, the one contract the brain also serves;
 * this file re-exports them and keeps the `ExamApi` interface the screens talk to.
 * `FakeExamApi` (synthetic data) implements it today; the real HTTP client comes later.
 */
import type {
  Answer, CheckOutcome, CheckResult, ExamItem, MarksView, MockAttempt, MockBrief, MockResultPreClose,
  MockReviewRow, ReportContext, TodayItemRef, TodayPlan, TopicRow,
} from '@vidhya/shared/api-contract';

export type {
  ItemKind,
  ItemOption,
  ItemVerification,
  ExamItem,
  Answer,
  CheckResult,
  CheckOutcome,
  TodayItemRef,
  TodayPlan,
  TopicRow,
  MockPhase,
  MockBrief,
  MockItemLite,
  MockAttempt,
  MockResultPreClose,
  MockReviewRow,
  MarksView,
  TaxonomyRow,
  ReportContext
} from '@vidhya/shared/api-contract';

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

  /** Answers held on the device while offline (DR5); the shell shows "Offline · N answers waiting". Optional: the fake has none. */
  onWaiting?(listener: (n: number) => void): () => void;

  getMarks(): Promise<MarksView>;
  report(itemId: string, note: string, context: ReportContext): Promise<void>;
}
