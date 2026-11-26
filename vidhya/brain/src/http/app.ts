/**
 * The brain's HTTP surface (plan B8): /health (no auth), /v1/* (session from the dt_token cookie,
 * validated by DeepTutor), and /mcp (identity-free tutor tools).
 *
 * Rules enforced here, in this order, for every /v1 request:
 *   1. Cache-Control: private, no-store on EVERY response (E9), errors included.
 *   2. Writes need Origin = the app origin and a JSON body (CSRF, R7-5).
 *   3. Identity comes ONLY from the cookie; no route reads a student id from a body or query (R7-1).
 *   4. 60 requests / minute / student.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { BrainError } from '../errors.js';
import { ROUTE_METHODS, ROUTE_PATTERNS, safeReturnPath, type HealthInfo, type RouteName } from '../../../shared/api-contract.js';
import type { Session } from '../session/resolve.js';
import type { Db } from '../store/db.js';
import { currentVersion } from '../store/migrate.js';
import { SCHEMA_VERSION } from '../store/db.js';
import { flagsOf, isEntitled, type Deps } from '../service/deps.js';
import { listTopics, serveItem, checkPractice, topicItems } from '../service/practice.js';
import { getMarks, getToday } from '../service/today.js';
import * as mock from '../service/mock.js';
import { toApiError } from './errors.js';
import { handleMcp } from '../mcp/server.js';
import { requireInternal, SERVABLE_PATH } from './internal.js';
import { servableForSync } from '../service/servable.js';

export interface AppConfig {
  /** The one Origin that may write, e.g. https://learn.example.org */
  appOrigin: string;
  /** Where an unauthenticated visitor signs in; the return path is appended as ?return= */
  loginPath: string;
  buildId: string;
  /** DeepTutor base URL, probed by /health. */
  deeptutorUrl: string;
  rateLimitPerMinute?: number;
  /** Bearer secret for the internal sync route (/v1/servable). Unset: that route is off. */
  syncToken?: string;
}

export interface AppDeps {
  deps: Deps;
  config: AppConfig;
  resolveSession: (cookieHeader: string | undefined) => Promise<Session>;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  session: Session;
  now: Date;
}
type Result = { status?: number; body: unknown } | { redirect: string };
type Handler = (c: Ctx) => Result | Promise<Result>;

const MAX_BODY = 64 * 1024;

function compile(pattern: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const src = pattern.replace(/:([A-Za-z]+)/g, (_m, n: string) => { names.push(n); return '([^/]+)'; });
  return { re: new RegExp(`^${src}$`), names };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const ct = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(ct)) throw new BrainError('UnsupportedMediaType', 'send JSON (Content-Type: application/json)');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new BrainError('PayloadTooLarge', 'request body is too large');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as unknown;
  } catch {
    throw new BrainError('BadRequest', 'body is not valid JSON');
  }
}

export function createApp(app: AppDeps): { server: Server; listener: (req: IncomingMessage, res: ServerResponse) => void } {
  const { deps, config } = app;
  const now = app.now ?? (() => new Date());
  const log = app.log ?? ((l) => process.stderr.write(`${JSON.stringify(l)}\n`));
  const limit = config.rateLimitPerMinute ?? 60;
  const windows = new Map<string, { start: number; n: number }>();

  const intParam = (c: Ctx) => mock.parseAttemptId(c.params.attemptId!);
  const handlers: Record<Exclude<RouteName, 'health' | 'login'>, Handler> = {
    session: (c) => {
      const f = flagsOf(deps, c.session.studentId, c.now);
      return { body: { studentId: c.session.studentId, flags: { exam_page: f.exam_page, nat: f.nat, mock: f.mock, today_card: f.today_card, disputes: f.disputes }, entitled: isEntitled(deps, c.session.studentId, c.now), buildId: config.buildId } };
    },
    today: (c) => {
      const m = c.query.get('minutes');
      return { body: getToday(deps, c.session.studentId, c.now, m === null ? undefined : Number(m)) };
    },
    topics: (c) => ({ body: listTopics(deps, c.session.studentId) }),
    topicItems: (c) => ({ body: topicItems(deps, c.session.studentId, c.params.topicId!) }),
    item: (c) => ({ body: serveItem(deps, c.session.studentId, c.params.itemId!, c.now) }),
    check: (c) => ({ body: checkPractice(deps, c.session.studentId, c.params.itemId!, c.body as never, c.now) }),
    mockBrief: (c) => ({ body: mock.getBrief(deps, c.session.studentId, c.now) }),
    mockStart: (c) => ({ status: 200, body: mock.startMock(deps, c.session.studentId, c.now) }),
    mockState: (c) => ({ body: mock.getAttempt(deps, c.session.studentId, intParam(c), c.now) }),
    mockAnswer: (c) => ({ body: mock.answerMock(deps, c.session.studentId, intParam(c), c.body as never, c.now) }),
    mockAutosave: (c) => ({ body: mock.autosave(deps, c.session.studentId, intParam(c), c.body as never, c.now) }),
    mockSubmit: (c) => ({ body: mock.submitMock(deps, c.session.studentId, intParam(c), c.now) }),
    mockResult: (c) => ({ body: mock.getResult(deps, c.session.studentId, intParam(c), c.now) }),
    mockReview: (c) => ({ body: mock.getReview(deps, c.session.studentId, c.now) }),
    marks: (c) => ({ body: getMarks(deps, c.session.studentId, c.now) }),
    report: (c) => ({ body: mock.report(deps, c.session.studentId, c.body as never, c.now) }),
  };

  const routes = (Object.keys(handlers) as (keyof typeof handlers)[]).map((name) => ({ name, method: ROUTE_METHODS[name], ...compile(ROUTE_PATTERNS[name]) }));
  const loginRoute = compile(ROUTE_PATTERNS.login);
  const healthRoute = compile(ROUTE_PATTERNS.health);

  async function health(): Promise<{ status: number; body: HealthInfo }> {
    let writable = false;
    let schema = 0;
    try {
      deps.db.exec('BEGIN IMMEDIATE; ROLLBACK;'); // takes and drops the write lock; changes nothing
      writable = true;
      schema = currentVersion(deps.db);
    } catch { /* reported below */ }
    let reachable = false;
    try {
      const r = await (app.fetchImpl ?? fetch)(new URL('/api/auth/status', config.deeptutorUrl), { signal: AbortSignal.timeout(1500) });
      reachable = r.status < 500;
    } catch { /* unreachable */ }
    const form = deps.pack.mock ? (deps.db.prepare('SELECT 1 FROM mock_forms WHERE form_version = ?').get(deps.pack.mock.form_version) ? 'ready' : 'unavailable') : 'none';
    const ok = writable && schema === SCHEMA_VERSION;
    return { status: ok ? 200 : 503, body: { ok, pack_version: deps.pack.version, schema_version: schema, db_writable: writable, deeptutor_auth_reachable: reachable, mock_form: form, last_sync: null, build_id: config.buildId } };
  }

  async function dispatch(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<{ status: number; code?: string }> {
    const url = new URL(req.url ?? '/', 'http://brain.local');
    const path = url.pathname;
    const send = (status: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json) });
      res.end(json);
      return { status };
    };
    try {
      if (path === '/mcp') {
        await handleMcp(req, res, deps, { now });
        return { status: res.statusCode };
      }
      if (healthRoute.re.test(path)) {
        if (req.method !== 'GET') throw new BrainError('MethodNotAllowed', 'GET only');
        const h = await health();
        return send(h.status, h.body);
      }
      if (!path.startsWith('/v1/')) throw new BrainError('NotFound', 'no such route');

      if (path === SERVABLE_PATH) {
        // Internal only: no cookie, no Origin, no student. Keys leave here, so the checks come first.
        if (req.method !== 'GET') throw new BrainError('MethodNotAllowed', 'GET only');
        requireInternal(req, config.syncToken);
        return send(200, servableForSync(deps, { pool: url.searchParams.get('pool'), type: url.searchParams.get('type'), version: url.searchParams.get('version') }));
      }

      if (loginRoute.re.test(path)) {
        if (req.method !== 'GET') throw new BrainError('MethodNotAllowed', 'GET only');
        const back = safeReturnPath(url.searchParams.get('return'));
        res.writeHead(302, { location: `${config.loginPath}?return=${encodeURIComponent(back)}` });
        res.end();
        return { status: 302 };
      }

      let matched: { name: keyof typeof handlers; params: Record<string, string> } | undefined;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        const params: Record<string, string> = {};
        r.names.forEach((n, i) => { try { params[n] = decodeURIComponent(m[i + 1]!); } catch { throw new BrainError('BadRequest', 'bad path encoding'); } });
        matched = { name: r.name, params };
        break;
      }
      if (!matched) throw new BrainError(pathMatched ? 'MethodNotAllowed' : 'NotFound', pathMatched ? 'wrong method for this route' : 'no such route');

      const isWrite = req.method !== 'GET';
      if (isWrite && req.headers.origin !== config.appOrigin) throw new BrainError('OriginRejected', 'writes must come from the exam app');

      const session = await app.resolveSession(req.headers.cookie);

      const t = now().getTime();
      const w = windows.get(session.studentId);
      if (!w || t - w.start >= 60_000) windows.set(session.studentId, { start: t, n: 1 });
      else if (++w.n > limit) throw new BrainError('RateLimited', 'too many requests; wait a minute');

      const body = isWrite ? await readBody(req) : undefined;
      const out = await handlers[matched.name]({ params: matched.params, query: url.searchParams, body, session, now: now() });
      if ('redirect' in out) { res.writeHead(302, { location: out.redirect }); res.end(); return { status: 302 }; }
      return send(out.status ?? 200, out.body);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'Internal') log({ level: 'error', request_id: requestId, error: e instanceof Error ? e.stack : String(e) });
      return { ...send(err.status, err.body), code: err.code };
    }
  }

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const t0 = Date.now();
    const requestId = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].slice(0, 64)) || randomUUID();
    // E9: personal responses are never cacheable. Set before anything can write, so errors carry it too.
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-vidhya-build', config.buildId);
    res.setHeader('x-content-type-options', 'nosniff');
    dispatch(req, res, requestId).then(
      (r) => log({ request_id: requestId, method: req.method, path: (req.url ?? '').split('?')[0], status: r.status, code: r.code, ms: Date.now() - t0 }),
      (e: unknown) => {
        log({ level: 'error', request_id: requestId, error: String(e) });
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      },
    );
  };
  return { server: createServer(listener), listener };
}

export type { Db };
