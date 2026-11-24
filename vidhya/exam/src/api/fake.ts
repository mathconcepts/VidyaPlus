/**
 * FakeExamApi: synthetic data for building and testing the app before the
 * brain's HTTP API exists. No real question bank, names or phone numbers
 * (CLAUDE.md rules 7 and 8). Keys live only inside this file, the way they
 * live only inside the brain.
 */
import type {
  Answer,
  CheckOutcome,
  CheckResult,
  ExamApi,
  ExamItem,
  ItemVerification,
  MarksView,
  MockAttempt,
  MockBrief,
  MockItemLite,
  MockResultPreClose,
  MockReviewRow,
  TodayItemRef,
  TodayPlan,
  TopicRow,
} from './types';

interface Seed {
  item: ExamItem;
  key: string; // 'B' | 'A,C' | '3'
  reason: string;
  natTolerance?: number;
}

const ok = (n: number): ItemVerification => ({
  state: 'verified',
  source: 'SymPy + Wolfram agree · 20 Nov v1',
  recordFingerprint: `fp-${n}`,
  engineLines: [
    'sympy: synthetic check #' + n + ' → match',
    'wolfram: synthetic check #' + n + ' → match',
    'key: match',
  ],
});

function mcq(n: number, id: string, topic: string, stem: string, opts: string[]): ExamItem {
  return {
    id,
    topic,
    topicLabel: topic,
    kind: 'mcq',
    marks: 1,
    negative: '−⅓',
    stemHtml: stem,
    options: opts.map((html, i) => ({ key: 'ABCD'[i], html })),
    fingerprint: `fp-${n}`,
    verification: ok(n),
  };
}

const SEEDS: Seed[] = [
  {
    item: mcq(17, 'gate-ec-017', 'Eigenvalues', 'Synthetic: the eigenvalues of A = [[2, 1], [1, 2]] are', ['1 and 3', '2 and 2', '0 and 4', '−1 and 3']),
    key: 'A',
    reason: 'Trace 4, determinant 3, so λ² − 4λ + 3 = 0 and λ = 1, 3.',
  },
  {
    item: {
      id: 'gate-ec-023',
      topic: 'Laplace',
      topicLabel: 'Laplace',
      kind: 'nat',
      marks: 2,
      negative: '0',
      stemHtml: 'Synthetic: the value of f(0⁺) for F(s) = (3s + 2)/(s² + 4s) is ____ (to one decimal place)',
      fingerprint: 'fp-23',
      verification: ok(23),
    },
    key: '3',
    reason: 'Initial value theorem: f(0⁺) = lim s·F(s) = 3.',
    natTolerance: 0.05,
  },
  {
    item: {
      id: 'gate-ec-031',
      topic: 'Eigenvalues',
      topicLabel: 'Eigenvalues',
      kind: 'msq',
      marks: 2,
      negative: '0',
      stemHtml: 'Synthetic: which of the following are true for a real symmetric matrix?',
      options: [
        { key: 'A', html: 'All eigenvalues are real' },
        { key: 'B', html: 'It is always invertible' },
        { key: 'C', html: 'It is orthogonally diagonalisable' },
        { key: 'D', html: 'Its determinant is positive' },
      ],
      fingerprint: 'fp-31',
      verification: { state: 'rechecking' },
    },
    key: 'A,C',
    reason: 'Real symmetric matrices have real eigenvalues and an orthogonal eigenbasis.',
  },
  {
    item: mcq(41, 'gate-ec-041', 'Linear algebra', 'Synthetic: the rank of a 3 × 3 matrix with two equal rows is at most', ['1', '2', '3', '0']),
    key: 'B',
    reason: 'Two equal rows leave at most two independent rows.',
  },
  {
    item: { ...mcq(52, 'gate-ec-052', 'Probability', 'Synthetic: a fair die is rolled once. P(even) is', ['1/6', '1/3', '1/2', '2/3']), verification: { state: 'withdrawn' } },
    key: 'C',
    reason: 'Three of six faces are even.',
  },
];

const byId = new Map(SEEDS.map(s => [s.item.id, s]));

/** 18 synthetic mock items: a mix of MCQ, MSQ and NAT, 30 marks in total. */
function buildMock(): { lite: MockItemLite[]; keys: Map<string, string> } {
  const lite: MockItemLite[] = [];
  const keys = new Map<string, string>();
  for (let i = 1; i <= 18; i++) {
    const id = `mock-${String(i).padStart(2, '0')}`;
    // 6 x 1 mark + 12 x 2 marks = 30 marks
    const m: 1 | 2 = i <= 6 ? 1 : 2;
    const kind = i % 6 === 0 ? 'nat' : i % 3 === 0 ? 'msq' : 'mcq';
    lite.push({
      id,
      kind,
      marks: m,
      negative: kind === 'mcq' ? '−⅓' : '0',
      stemHtml: `Synthetic mock question ${i}.`,
      options:
        kind === 'nat'
          ? undefined
          : ['A', 'B', 'C', 'D'].map(k => ({ key: k, html: `Option ${k}` })),
    });
    keys.set(id, kind === 'nat' ? '4' : kind === 'msq' ? 'A,C' : 'B');
  }
  return { lite, keys };
}

const delay = <T,>(v: T, ms = 0): Promise<T> => new Promise(r => setTimeout(() => r(v), ms));

function answerKeyOf(a: Answer | null): string {
  if (!a) return '';
  if (a.kind === 'mcq') return a.key;
  if (a.kind === 'msq') return [...a.keys].sort().join(',');
  return a.raw.trim();
}

export interface FakeOptions {
  /** 'starter' (no estimate yet) or 'estimate' (after 30 attempts or the mock). Default 'starter'. */
  today?: 'starter' | 'estimate';
  phase?: MockBrief['phase'];
  taken?: MockBrief['taken'];
  marks?: 'empty' | 'filled';
  /** Server clock and deadline offsets for the running mock, in ms. Default: 54 minutes left. */
  mockMsLeft?: number;
  latencyMs?: number;
}

export class FakeExamApi implements ExamApi {
  private online = true;
  private listeners = new Set<(r: CheckResult) => void>();
  private queued: Array<{ itemId: string; answer: Answer }> = [];
  private mock = buildMock();
  private mockAnswers = new Map<string, { answer: Answer | null; flagged: boolean }>();
  private submitted = false;
  readonly reports: Array<{ itemId: string; note: string; context: string }> = [];
  readonly mockLog: Array<{ itemId: string; answer: Answer | null; flagged: boolean }> = [];
  constructor(private opts: FakeOptions = {}) {}

  setOnline(on: boolean): void {
    this.online = on;
    if (on) {
      const q = this.queued;
      this.queued = [];
      for (const { itemId, answer } of q) {
        const r = this.grade(itemId, answer);
        this.listeners.forEach(l => l(r));
      }
    }
  }

  private weekCount = 2;

  private grade(itemId: string, answer: Answer): CheckResult {
    const seed = byId.get(itemId);
    if (!seed) throw new Error(`unknown item ${itemId}`);
    const given = answerKeyOf(answer);
    let correct = given === seed.key;
    if (seed.item.kind === 'nat' && answer.kind === 'nat') {
      const v = Number(answer.raw);
      correct = Number.isFinite(v) && Math.abs(v - Number(seed.key)) <= (seed.natTolerance ?? 0);
    }
    const skipped = given === '';
    const outcome = skipped ? 'skipped' : correct ? 'correct' : 'wrong';
    if (correct) this.weekCount += 1;
    return {
      itemId,
      outcome,
      yours: given,
      key: seed.key,
      reason: seed.reason,
      scored: correct ? seed.item.marks : seed.item.kind === 'mcq' && !skipped ? -1 / 3 : 0,
      week: correct ? { right: this.weekCount, total: 4, topicNoun: seed.item.topic.toLowerCase().replace(/s$/, '') } : null,
      verification: seed.item.verification,
    };
  }

  async getToday(): Promise<TodayPlan> {
    const estimate = this.opts.today === 'estimate' ? { low: 0.8, high: 1.4, attempts: 34 } : null;
    const items: TodayItemRef[] = SEEDS.slice(0, 4).map(s => ({ id: s.item.id, topicLabel: s.item.topicLabel, kind: s.item.kind }));
    return delay(
      {
        minutes: 30,
        items,
        topics: ['Eigenvalues', 'Laplace'],
        gateWeightMarks: 4,
        estimate,
        mockLine: 'Mock opens Sun 13 Dec',
        continueRow: { label: 'Continue NAT · Laplace', progress: '2 of 5' },
        withdrawnCount: 0,
        cleared: false,
      },
      this.opts.latencyMs,
    );
  }

  async listTopics(): Promise<TopicRow[]> {
    return [
      { id: 'laplace', label: 'Laplace', natCount: 2 },
      { id: 'eigenvalues', label: 'Eigenvalues', natCount: 1 },
      { id: 'probability', label: 'Probability', natCount: 0 },
    ];
  }

  async topicItems(topicId: string): Promise<TodayItemRef[]> {
    return SEEDS.filter(s => s.item.kind === 'nat' && s.item.topic.toLowerCase() === topicId).map(s => ({
      id: s.item.id,
      topicLabel: s.item.topicLabel,
      kind: s.item.kind,
    }));
  }

  async getItem(itemId: string): Promise<ExamItem> {
    const s = byId.get(itemId);
    if (!s) throw new Error(`unknown item ${itemId}`);
    return delay(s.item, this.opts.latencyMs);
  }

  async checkAnswer(itemId: string, answer: Answer): Promise<CheckOutcome> {
    if (!this.online) {
      this.queued.push({ itemId, answer });
      return { status: 'queued' };
    }
    return delay({ status: 'checked', result: this.grade(itemId, answer) }, this.opts.latencyMs);
  }

  onQueuedResult(listener: (r: CheckResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getMockBrief(): Promise<MockBrief> {
    return {
      phase: this.opts.phase ?? 'open',
      taken: this.submitted ? 'submitted' : this.opts.taken ?? 'none',
      opensOn: 'Sun 13 Dec',
      closesOn: 'Sun 20 Dec',
      unlockOn: 'Sun 20 Dec',
      minutes: 54,
      questions: this.mock.lite.length,
      totalMarks: 30,
      rules: [
        'One scored attempt',
        'The timer keeps running if you leave',
        'MCQ −⅓ · MSQ and NAT no negative marks',
        'Answers unlock for everyone on Sun 20 Dec',
      ],
    };
  }

  async startMock(): Promise<MockAttempt> {
    const now = 1_700_000_000_000;
    const left = this.opts.mockMsLeft ?? 54 * 60_000;
    return {
      attemptId: 'attempt-1',
      serverNowMs: now,
      deadlineMs: now + left,
      items: this.mock.lite,
      saved: Object.fromEntries(this.mockAnswers),
    };
  }

  async answerMock(_attemptId: string, itemId: string, answer: Answer | null, flagged: boolean): Promise<void> {
    this.mockAnswers.set(itemId, { answer, flagged });
    this.mockLog.push({ itemId, answer, flagged });
  }

  async submitMock(): Promise<void> {
    this.submitted = true;
  }

  async getMockResult(): Promise<MockResultPreClose> {
    let right = 0;
    let wrong = 0;
    let score = 0;
    for (const it of this.mock.lite) {
      const a = this.mockAnswers.get(it.id)?.answer ?? null;
      if (!a) continue;
      if (answerKeyOf(a) === this.mock.keys.get(it.id)) {
        right += 1;
        score += it.marks;
      } else {
        wrong += 1;
        if (it.kind === 'mcq') score -= 1 / 3;
      }
    }
    return {
      score: Math.round(score * 100) / 100,
      outOf: 30,
      right,
      wrong,
      skipped: this.mock.lite.length - right - wrong,
      submittedOn: '14 Dec',
      unlockOn: 'Sun 20 Dec',
    };
  }

  async getMockReview(): Promise<MockReviewRow[]> {
    return SEEDS.slice(0, 3).map(s => ({
      item: s.item,
      result: this.grade(s.item.id, s.item.kind === 'nat' ? { kind: 'nat', raw: '3' } : s.item.kind === 'msq' ? { kind: 'msq', keys: ['A'] } : { kind: 'mcq', key: 'A' }),
    }));
  }

  async getMarks(): Promise<MarksView> {
    if (this.opts.marks === 'empty') return { range: null, basis: '', lastWeek: null, lost: [] };
    return {
      range: { low: 9, high: 12, of: 15 },
      basis: 'Estimate from the mock and 34 practice attempts.',
      lastWeek: 'Last week: 8–11.',
      lost: [
        { label: 'Setup error', marks: 6 },
        { label: 'Arithmetic slip', marks: 4 },
        { label: 'Concept gap', marks: 3 },
        { label: 'Unclassified', marks: 2 },
      ],
    };
  }

  async report(itemId: string, note: string, context: 'item' | 'mock'): Promise<void> {
    this.reports.push({ itemId, note, context });
  }
}
