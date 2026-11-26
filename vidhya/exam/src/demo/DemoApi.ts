/**
 * DemoExamApi: the whole /exam API over synthetic, in-memory data, for the static demo build only.
 * Reached solely through the dynamic import in demo/mount.tsx behind `import.meta.env.MODE === 'demo'`,
 * so a production bundle never contains it. Nothing is persisted. No network calls.
 */
import type {
  Answer, CheckOutcome, CheckResult, ExamApi, ExamItem, ItemVerification, MarksView, MockAttempt, MockBrief,
  MockItemLite, MockResultPreClose, MockReviewRow, TodayItemRef, TodayPlan, TopicRow,
} from '../api/types';
import { ExamApiError, DOWN_COPY } from '../api/errors';
import type { DemoConfig } from './config';
import { MOCK_ITEMS, PRACTICE_ITEMS, type DemoItem } from './items.generated';

const SOURCE = 'Synthetic demo record: not a real verification';
function verificationOf(it: DemoItem): ItemVerification {
  if (it.verification === 'withdrawn') return { state: 'withdrawn' };
  if (it.verification === 'rechecking') return { state: 'rechecking' };
  return { state: 'verified', source: SOURCE, recordFingerprint: fp(it), engineLines: ['sympy: synthetic check, match', 'wolfram: synthetic check, match', 'key: match'] };
}
const fp = (it: DemoItem): string => `fp-${it.id}`;

function toExamItem(it: DemoItem, inMock = false): ExamItem {
  return {
    id: it.id, topic: it.topic, topicLabel: it.topic, kind: it.kind, marks: it.marks, negative: it.negative,
    stemHtml: it.stemHtml, options: it.options, fingerprint: fp(it), verification: verificationOf(it), inMock: inMock || undefined,
  };
}

const answerKey = (a: Answer | null): string => (!a ? '' : a.kind === 'mcq' ? a.key : a.kind === 'msq' ? [...a.keys].sort().join(',') : a.raw.trim());

function isRight(it: DemoItem, a: Answer | null): boolean {
  if (!a) return false;
  if (it.kind === 'nat' && a.kind === 'nat') {
    const v = Number(a.raw);
    return Number.isFinite(v) && Math.abs(v - Number(it.key)) <= (it.natTolerance ?? 0);
  }
  return answerKey(a) === it.key;
}

/** What a student who sat the mock "answered", used when the demo opens in a state where the mock was already taken. */
function scriptedAnswer(it: DemoItem, n: number): Answer | null {
  if (n % 5 === 4) return null; // skipped
  const right = n % 3 !== 2;
  if (it.kind === 'nat') return { kind: 'nat', raw: right ? it.key : String(Number(it.key) + 1) };
  if (it.kind === 'msq') return { kind: 'msq', keys: right ? it.key.split(',') : [it.key.split(',')[0]!] };
  const wrongKey = 'ABCD'.split('').find(k => k !== it.key)!;
  return { kind: 'mcq', key: right ? it.key : wrongKey };
}

const MIN = 60_000;
const NOW = 1_700_000_000_000;

export class DemoExamApi implements ExamApi {
  private weekCount = 2;
  private submitted = false;
  private online: boolean;
  private queued: Array<{ itemId: string; answer: Answer }> = [];
  private listeners = new Set<(r: CheckResult) => void>();
  private waitingListeners = new Set<(n: number) => void>();
  private mockAnswers = new Map<string, { answer: Answer | null; flagged: boolean }>();
  private practice = new Map(PRACTICE_ITEMS.map(i => [i.id, i]));

  constructor(private cfg: DemoConfig) {
    this.online = !cfg.offline;
    const preTaken = cfg.mock === 'in-progress' || cfg.mock === 'last-minutes' || cfg.mock === 'time-up' || cfg.mock === 'closed-taker';
    if (preTaken) {
      const upto = cfg.mock === 'in-progress' || cfg.mock === 'last-minutes' ? 7 : MOCK_ITEMS.length;
      MOCK_ITEMS.slice(0, upto).forEach((it, n) => this.mockAnswers.set(it.id, { answer: scriptedAnswer(it, n), flagged: n === 2 || n === 5 }));
    }
    if (cfg.mock === 'closed-taker') this.submitted = true;
  }

  private guard(): void {
    if (this.cfg.outage) throw new ExamApiError('Unavailable', DOWN_COPY, { status: 503, down: true });
  }

  onWaiting(listener: (n: number) => void): () => void {
    this.waitingListeners.add(listener);
    listener(this.queued.length);
    return () => this.waitingListeners.delete(listener);
  }

  private grade(it: DemoItem, answer: Answer): CheckResult {
    const given = answerKey(answer);
    const correct = isRight(it, answer);
    const skipped = given === '';
    if (correct) this.weekCount += 1;
    return {
      itemId: it.id, outcome: skipped ? 'skipped' : correct ? 'correct' : 'wrong', yours: given, key: it.key,
      reason: it.reason, reasonHtml: it.reasonHtml,
      scored: correct ? it.marks : it.kind === 'mcq' && !skipped ? -1 / 3 : 0,
      week: correct ? { right: this.weekCount, total: 4, topicNoun: it.topic.toLowerCase() } : null,
      verification: verificationOf(it),
    };
  }

  async getToday(): Promise<TodayPlan> {
    this.guard();
    const ids = ['demo-017', 'demo-023', 'demo-031', 'demo-044'];
    const phase = this.phase();
    return {
      minutes: 30,
      items: ids.map(id => ref(this.practice.get(id)!)),
      topics: ['Eigenvalues', 'Laplace', 'Calculus'],
      gateWeightMarks: 9,
      estimate: this.cfg.today === 'estimate' ? { low: 2, high: 4, attempts: 34 } : null,
      mockLine: phase === 'before-open' ? 'Mock opens Sun 13 Dec' : phase === 'open' ? 'Mock is open until Sun 20 Dec' : 'Mock closed · answers unlocked',
      continueRow: { label: 'Continue NAT · Laplace', progress: '1 of 2' },
      withdrawnCount: this.cfg.today === 'estimate' ? 1 : 0,
      cleared: this.cfg.today === 'cleared',
    };
  }

  async listTopics(): Promise<TopicRow[]> {
    this.guard();
    return [
      { id: 'laplace', label: 'Laplace', natCount: 2 },
      { id: 'calculus', label: 'Calculus', natCount: 2 },
      { id: 'eigenvalues', label: 'Eigenvalues', natCount: 1 },
      { id: 'probability', label: 'Probability', natCount: 2 },
      { id: 'linear-algebra', label: 'Linear algebra', natCount: 0 },
    ];
  }

  async topicItems(topicId: string): Promise<TodayItemRef[]> {
    this.guard();
    return PRACTICE_ITEMS.filter(i => i.kind === 'nat' && i.topic.toLowerCase() === topicId).map(ref);
  }

  async getItem(itemId: string): Promise<ExamItem> {
    this.guard();
    const it = this.practice.get(itemId);
    if (!it) throw new ExamApiError('NotFound', `unknown item ${itemId}`, { status: 404 });
    return toExamItem(it);
  }

  async checkAnswer(itemId: string, answer: Answer): Promise<CheckOutcome> {
    this.guard();
    const it = this.practice.get(itemId)!;
    if (!this.online) {
      this.queued.push({ itemId, answer });
      this.waitingListeners.forEach(l => l(this.queued.length));
      return { status: 'queued' };
    }
    await new Promise(r => setTimeout(r, 250));
    return { status: 'checked', result: this.grade(it, answer) };
  }

  onQueuedResult(listener: (r: CheckResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Demo controls: go offline (answers are held) or back online (the shell's banner clears and held answers are checked). */
  setOnline(on: boolean): void {
    if (!on) { this.online = false; return; }
    this.online = true;
    const q = this.queued;
    this.queued = [];
    this.waitingListeners.forEach(l => l(0));
    for (const { itemId, answer } of q) {
      const r = this.grade(this.practice.get(itemId)!, answer);
      this.listeners.forEach(l => l(r));
    }
  }

  private phase(): MockBrief['phase'] {
    return this.cfg.mock === 'before-open' ? 'before-open' : this.cfg.mock === 'closed-taker' || this.cfg.mock === 'closed-practice' ? 'closed' : 'open';
  }

  async getMockBrief(): Promise<MockBrief> {
    this.guard();
    const m = this.cfg.mock;
    const inProgress = m === 'in-progress' || m === 'last-minutes' || m === 'time-up';
    return {
      phase: this.phase(),
      taken: this.submitted ? 'submitted' : inProgress ? 'in-progress' : 'none',
      opensOn: 'Sun 13 Dec', closesOn: 'Sun 20 Dec', unlockOn: 'Sun 20 Dec',
      minutes: 54, questions: MOCK_ITEMS.length, totalMarks: 30,
      rules: ['One scored attempt', 'The timer keeps running if you leave', 'MCQ −⅓ · MSQ and NAT no negative marks', 'Answers unlock for everyone on Sun 20 Dec'],
    };
  }

  async startMock(): Promise<MockAttempt> {
    this.guard();
    const left = this.cfg.mock === 'last-minutes' ? 4 * MIN : this.cfg.mock === 'time-up' || this.submitted ? 0 : this.cfg.mock === 'in-progress' ? 37 * MIN : 54 * MIN;
    const items: MockItemLite[] = MOCK_ITEMS.map(it => ({ id: it.id, kind: it.kind, marks: it.marks, negative: it.negative, stemHtml: it.stemHtml, options: it.options }));
    return { attemptId: 'demo-attempt', serverNowMs: NOW, deadlineMs: NOW + left, items, saved: Object.fromEntries(this.mockAnswers) };
  }

  async answerMock(_attemptId: string, itemId: string, answer: Answer | null, flagged: boolean): Promise<void> {
    this.guard();
    this.mockAnswers.set(itemId, { answer, flagged });
  }

  async submitMock(): Promise<void> {
    this.guard();
    this.submitted = true;
  }

  async getMockResult(): Promise<MockResultPreClose> {
    this.guard();
    let right = 0, wrong = 0, score = 0;
    for (const it of MOCK_ITEMS) {
      const a = this.mockAnswers.get(it.id)?.answer ?? null;
      if (!a) continue;
      if (isRight(it, a)) { right += 1; score += it.marks; } else { wrong += 1; if (it.kind === 'mcq') score -= 1 / 3; }
    }
    return { score: Math.round(score * 100) / 100, outOf: 30, right, wrong, skipped: MOCK_ITEMS.length - right - wrong, submittedOn: '14 Dec', unlockOn: 'Sun 20 Dec' };
  }

  async getMockReview(): Promise<MockReviewRow[]> {
    this.guard();
    return MOCK_ITEMS.map((it, n) => {
      const given = this.mockAnswers.get(it.id)?.answer ?? scriptedAnswer(it, n);
      const shown: ExamItem = toExamItem(it, true);
      // A couple of rows show the other receipt states, so the review exercises all of them.
      if (n === 7) shown.verification = { state: 'rechecking' };
      const empty: Answer = it.kind === 'nat' ? { kind: 'nat', raw: '' } : it.kind === 'msq' ? { kind: 'msq', keys: [] } : { kind: 'mcq', key: '' };
      const result = this.grade(it, given ?? empty);
      return { item: shown, result: { ...result, verification: shown.verification, week: null } };
    });
  }

  async getMarks(): Promise<MarksView> {
    this.guard();
    if (this.cfg.marks === 'needs-more') return { range: null, basis: 'Take the mock to see your marks range.', lastWeek: null, lost: [], status: 'needs_more' };
    const low = this.cfg.marks === 'low-n';
    return {
      status: 'ok',
      range: low ? { low: 4, high: 12, of: 15 } : { low: 9, high: 12, of: 15 },
      basis: low ? 'Estimate from 6 attempts.' : 'Estimate from the mock and 34 practice attempts.',
      lowN: low,
      attempts: low ? 6 : 34,
      lastWeek: low ? null : 'Last week: 8–11.',
      lost: [],
      wrongTotal: low ? 3 : 15,
      taxonomy: low
        ? [
            { bucket: 'TIME', label: 'Time pressure', wrong: 0 },
            { bucket: 'EXAMCRAFT', label: 'Exam craft', wrong: 1 },
            { bucket: 'CALC', label: 'Calculation slip', wrong: 1 },
            { bucket: 'CONCEPT', label: 'Concept gap', wrong: 0 },
            { bucket: 'UNCLASSIFIED', label: 'Unclassified', wrong: 1 },
          ]
        : [
            { bucket: 'TIME', label: 'Time pressure', wrong: 2 },
            { bucket: 'EXAMCRAFT', label: 'Exam craft', wrong: 3 },
            { bucket: 'CALC', label: 'Calculation slip', wrong: 4 },
            { bucket: 'CONCEPT', label: 'Concept gap', wrong: 5 },
            { bucket: 'UNCLASSIFIED', label: 'Unclassified', wrong: 1 },
          ],
      score: low ? undefined : { score: 21.67, outOf: 30, label: 'unproctored practice mock' },
    };
  }

  async report(): Promise<void> {
    this.guard();
  }
}

const ref = (it: DemoItem): TodayItemRef => ({ id: it.id, topicLabel: it.topic, kind: it.kind });
