/**
 * HttpExamApi: the real ExamApi, over the brain's /v1 routes (`vidhya/shared/api-contract.ts`).
 *
 *  - Same-origin fetch with credentials; identity is the dt_token cookie, never a body field (R1, R7-1).
 *    The browser adds `Origin` on POST; this file sets no Origin.
 *  - Errors arrive as `{code, message}` and become `ExamApiError`.
 *  - 401 (SessionMissing) sends the browser to /v1/login?return=<current /exam/ path> (E9).
 *  - A network failure or a proxy 502/503/504 is `ExamApiError` with `down: true` and the DR8 copy.
 *  - Offline (DR5): a practice check or a mock answer that cannot reach the brain is held in an
 *    owner-tagged queue (E7), persisted in localStorage, and sent when the network is back. Entries from
 *    another login are held, never sent and never deleted. Results of queued checks reach
 *    `onQueuedResult` listeners.
 *  - E10: when a response's X-Vidhya-Build differs from the build id this app was built with, the
 *    `onBuildMismatch` listeners fire once and the shell shows its refresh banner.
 */
import {
  ROUTE_METHODS, routePath, safeReturnPath, type MockAnswerRequest, type MockAutosaveResponse, type RouteName, type SessionInfo,
} from '@vidhya/shared/api-contract';
import type {
  Answer, CheckOutcome, CheckResult, ExamApi, ExamItem, MarksView, MockAttempt, MockBrief, MockResultPreClose, MockReviewRow,
  ReportContext, TodayItemRef, TodayPlan, TopicRow,
} from './types';
import { DOWN_COPY, ExamApiError } from './errors';

export const QUEUE_KEY = 'vidhya.exam.queue.v1';
const FLUSH_EVERY_MS = 10_000;

type QueueEntry =
  | { kind: 'check'; owner: string; itemId: string; answer: Answer; key: string; elapsedMs?: number }
  | { kind: 'mock'; owner: string; attemptId: string; req: MockAnswerRequest };

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  /** Navigate the browser. Default: window.location.assign. */
  redirect?: (url: string) => void;
  /** The current path + query + hash, used as the login return. Default: from window.location. */
  currentPath?: () => string;
  /** Offline queue storage. Default: window.localStorage when available; null disables persistence. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Build id this app was built with. Unset or 'dev' disables the same-build check. */
  buildId?: string;
  now?: () => number;
  /** Retry the queue on a timer while it is not empty. Default 10 s; 0 disables (tests). */
  flushEveryMs?: number;
  /** Subscribe to "back online". Default: window 'online' event. */
  onOnline?: (cb: () => void) => void;
}

const uuid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export class HttpExamApi implements ExamApi {
  private readonly f: typeof fetch;
  private readonly redirect: (url: string) => void;
  private readonly currentPath: () => string;
  private readonly storage: HttpOptions['storage'];
  private readonly buildId?: string;
  private readonly now: () => number;
  private owner: string | null = null;
  private queue: QueueEntry[] = [];
  private flushP: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly flushEveryMs: number;
  private served = new Map<string, number>();
  private resultListeners = new Set<(r: CheckResult) => void>();
  private waitingListeners = new Set<(n: number) => void>();
  private buildListeners = new Set<(serverBuild: string) => void>();
  private buildNotified = false;

  constructor(opts: HttpOptions = {}) {
    this.f = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.redirect = opts.redirect ?? ((u) => window.location.assign(u));
    this.currentPath = opts.currentPath ?? (() => window.location.pathname + window.location.search + window.location.hash);
    this.storage = opts.storage === undefined ? (typeof window !== 'undefined' ? safeStorage() : null) : opts.storage;
    this.buildId = opts.buildId && opts.buildId !== 'dev' ? opts.buildId : undefined;
    this.now = opts.now ?? Date.now;
    this.flushEveryMs = opts.flushEveryMs ?? FLUSH_EVERY_MS;
    this.queue = this.load();
    (opts.onOnline ?? ((cb) => { if (typeof window !== 'undefined') window.addEventListener('online', cb); }))(() => { void this.flush(); });
  }

  // ------------------------------------------------------------------ transport

  private async request<T>(route: RouteName, o: { params?: Record<string, string | number>; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const method = ROUTE_METHODS[route];
    let url = routePath(route, o.params);
    if (o.query) url += `?${new URLSearchParams(o.query).toString()}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (method !== 'GET') { headers['content-type'] = 'application/json'; body = JSON.stringify(o.body ?? {}); }
    let res: Response;
    try {
      res = await this.f(url, { method, credentials: 'same-origin', headers, body, redirect: 'manual', cache: 'no-store' });
    } catch {
      throw new ExamApiError('Offline', DOWN_COPY, { down: true });
    }
    this.checkBuild(res);
    // A fetch with redirect:'manual' reports a redirect as an opaque response; /v1 only redirects /v1/login.
    if (res.status === 401) {
      this.redirect(`${routePath('login')}?return=${encodeURIComponent(safeReturnPath(this.currentPath()))}`);
      throw new ExamApiError('SessionMissing', 'Signing you in again.', { status: 401 });
    }
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON: a proxy page */ }
    if (!res.ok) {
      const e = json as { code?: unknown; message?: unknown } | null;
      if (e && typeof e.code === 'string') throw new ExamApiError(e.code, typeof e.message === 'string' ? e.message : e.code, { status: res.status });
      if (res.status === 502 || res.status === 503 || res.status === 504) throw new ExamApiError('Down', DOWN_COPY, { status: res.status, down: true });
      throw new ExamApiError(`Http${res.status}`, 'Something went wrong on our side.', { status: res.status });
    }
    return json as T;
  }

  private checkBuild(res: Response): void {
    const server = res.headers.get('x-vidhya-build');
    if (this.buildId && server && server !== this.buildId && !this.buildNotified) {
      this.buildNotified = true;
      this.buildListeners.forEach((l) => l(server));
    }
  }

  /** E10: called once when the brain reports a different build than this app. */
  onBuildMismatch(listener: (serverBuild: string) => void): () => void {
    this.buildListeners.add(listener);
    return () => this.buildListeners.delete(listener);
  }

  /** Signed-in student id; also tags the offline queue (E7). Call once at startup. */
  async init(): Promise<SessionInfo> {
    const s = await this.request<SessionInfo>('session');
    this.owner = s.studentId;
    this.armTimer();
    void this.flush();
    return s;
  }

  // ------------------------------------------------------------------ practice

  getToday(): Promise<TodayPlan> { return this.request('today'); }
  listTopics(): Promise<TopicRow[]> { return this.request('topics'); }
  topicItems(topicId: string): Promise<TodayItemRef[]> { return this.request('topicItems', { params: { topicId } }); }

  async getItem(itemId: string): Promise<ExamItem> {
    const item = await this.request<ExamItem>('item', { params: { itemId } });
    this.served.set(itemId, this.now());
    return item;
  }

  async checkAnswer(itemId: string, answer: Answer): Promise<CheckOutcome> {
    const t0 = this.served.get(itemId);
    const elapsedMs = t0 === undefined ? undefined : Math.max(0, Math.round(this.now() - t0));
    const key = uuid();
    try {
      return { status: 'checked', result: await this.sendCheck(itemId, answer, key, elapsedMs) };
    } catch (e) {
      if (e instanceof ExamApiError && e.code === 'Offline' && this.owner) {
        this.enqueue({ kind: 'check', owner: this.owner, itemId, answer, key, elapsedMs });
        return { status: 'queued' }; // DR5: the screen says "Saved · we'll check it when you're back online"
      }
      throw e;
    }
  }

  private async sendCheck(itemId: string, answer: Answer, idempotencyKey: string, elapsedMs?: number): Promise<CheckResult> {
    const out = await this.request<CheckOutcome>('check', { params: { itemId }, body: { answer, idempotencyKey, ...(elapsedMs === undefined ? {} : { elapsedMs }) } });
    if (out.status !== 'checked') throw new ExamApiError('BadResponse', 'The server did not return a result.');
    return out.result;
  }

  onQueuedResult(listener: (r: CheckResult) => void): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  // ------------------------------------------------------------------ mock

  getMockBrief(): Promise<MockBrief> { return this.request('mockBrief'); }
  startMock(): Promise<MockAttempt> { return this.request('mockStart'); }

  async answerMock(attemptId: string, itemId: string, answer: Answer | null, flagged: boolean): Promise<void> {
    if (!this.owner) await this.init();
    const req: MockAnswerRequest = { itemId, answer, flagged, idempotencyKey: uuid(), enteredAt: new Date(this.now()).toISOString(), queueOwner: this.owner! };
    // Order matters: while older answers for this attempt wait, a new one waits behind them.
    if (this.queue.some((q) => q.kind === 'mock' && q.attemptId === attemptId && q.owner === this.owner)) {
      this.enqueue({ kind: 'mock', owner: this.owner!, attemptId, req });
      void this.flush();
      return;
    }
    try {
      await this.request('mockAnswer', { params: { attemptId }, body: req });
    } catch (e) {
      if (e instanceof ExamApiError && e.code === 'Offline') { this.enqueue({ kind: 'mock', owner: this.owner!, attemptId, req }); return; }
      throw e;
    }
  }

  async submitMock(attemptId: string): Promise<void> {
    await this.flush(); // late queued answers go first; the server's 2 minute window (E3) still applies
    await this.request('mockSubmit', { params: { attemptId } });
  }

  getMockResult(attemptId: string): Promise<MockResultPreClose> { return this.request('mockResult', { params: { attemptId } }); }
  getMockReview(): Promise<MockReviewRow[]> { return this.request('mockReview'); }

  // ------------------------------------------------------------------ marks, report

  getMarks(): Promise<MarksView> { return this.request('marks'); }
  async report(itemId: string, note: string, context: ReportContext): Promise<void> {
    await this.request('report', { body: { itemId, note, context } });
  }

  // ------------------------------------------------------------------ offline queue (DR5, E7, E12)

  /** Answers waiting for the signed-in student, for "Offline · N answers waiting". */
  waiting(): number { return this.queue.filter((q) => q.owner === this.owner).length; }
  /** Answers from another login, held and never sent (E7). */
  heldForOthers(): number { return this.queue.filter((q) => q.owner !== this.owner).length; }

  onWaiting(listener: (n: number) => void): () => void {
    this.waitingListeners.add(listener);
    return () => this.waitingListeners.delete(listener);
  }

  private enqueue(e: QueueEntry): void {
    this.queue.push(e);
    this.persist();
    this.armTimer();
  }

  private armTimer(): void {
    if (this.timer || this.flushEveryMs <= 0 || this.queue.length === 0) return;
    this.timer = setInterval(() => { void this.flush(); }, this.flushEveryMs);
  }

  /** Send what is waiting for this student, in order. Stops at the first network failure. */
  async flush(): Promise<void> {
    if (!this.owner) return;
    while (this.flushP) await this.flushP.catch(() => undefined); // never two sends at once; a later caller still gets its own pass
    const run = this.flushOnce().finally(() => { if (this.flushP === run) this.flushP = null; });
    this.flushP = run;
    return run;
  }

  private async flushOnce(): Promise<void> {
    try {
      for (;;) {
        const next = this.queue.find((q) => q.owner === this.owner);
        if (!next) break;
        try {
          if (next.kind === 'check') {
            const r = await this.sendCheck(next.itemId, next.answer, next.key, next.elapsedMs);
            this.drop(next);
            this.resultListeners.forEach((l) => l(r));
          } else {
            // Batch every waiting answer of this attempt through the autosave route (R21).
            const batch = this.queue.filter((q): q is Extract<QueueEntry, { kind: 'mock' }> => q.kind === 'mock' && q.owner === this.owner && q.attemptId === next.attemptId);
            await this.request<MockAutosaveResponse>('mockAutosave', { params: { attemptId: next.attemptId }, body: { entries: batch.map((b) => b.req) } });
            batch.forEach((b) => this.drop(b)); // saved, duplicate or refused: the server has decided, nothing left to retry
          }
        } catch (e) {
          if (e instanceof ExamApiError && (e.down || e.code === 'SessionMissing')) break; // try again later
          this.drop(next); // a definite refusal (for example access ended, E12): do not retry forever
        }
      }
    } finally {
      if (this.queue.length === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
    }
  }

  private drop(e: QueueEntry): void {
    this.queue = this.queue.filter((q) => q !== e);
    this.persist();
  }

  private persist(): void {
    try { this.storage?.setItem(QUEUE_KEY, JSON.stringify(this.queue)); } catch { /* storage full or blocked: memory still holds it */ }
    const n = this.waiting();
    this.waitingListeners.forEach((l) => l(n));
  }

  private load(): QueueEntry[] {
    try {
      const raw = this.storage?.getItem(QUEUE_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? (arr as QueueEntry[]).filter((q) => q && typeof q.owner === 'string' && (q.kind === 'check' || q.kind === 'mock')) : [];
    } catch { return []; }
  }
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
