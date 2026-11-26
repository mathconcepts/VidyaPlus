/**
 * End-to-end smoke: the real brain server (synthetic pack, real SQLite file) behind a stub DeepTutor
 * auth server, driven by the /exam app's real HttpExamApi in Node. Nothing is mocked between the two:
 * the client's fetch is only given a base URL, the session cookie and the Origin a browser would add.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, type Started } from '../server.js';
import { runMigrations } from '../store/migrate.js';
import { openStore } from '../store/db.js';
import { hashId, upsertStudent } from '../registry/registry.js';
import { MOCK_ITEMS, PRACTICE, TIERS } from '../http/__tests__/harness.js';
import { GATE_LIKE } from '../scoring/__tests__/fixtures.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const SALT = 'smoke-salt';
const ORIGIN = 'https://learn.smoke.test';
const EXAM = path.resolve(__dirname, '../../../exam/src/api');
const SYNC = path.resolve(__dirname, '../../../sync/src');

let dir: string;
let dt: Server;
let brain: Started;
let base: string;
let HttpExamApi: new (o: Record<string, unknown>) => any;
let ExamApiError: new (...a: any[]) => Error;

function clientFor(user: string | null, extra: Record<string, unknown> = {}) {
  const redirects: string[] = [];
  const store: Record<string, string> = {};
  const fetchImpl = (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set('cookie', `dt_token=tok-${user}`);
    if (init.method && init.method !== 'GET') headers.set('origin', ORIGIN); // a browser adds this on same-origin POST
    return fetch(base + url, { ...init, headers });
  };
  const api = new HttpExamApi({
    fetchImpl, redirect: (u: string) => redirects.push(u), currentPath: () => '/exam/mock', flushEveryMs: 0, onOnline: () => undefined,
    storage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, ...extra,
  });
  return { api, redirects };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'vidhya-smoke-'));
  const dbFile = path.join(dir, 'brain.db');
  await runMigrations(dbFile, { backupDir: path.join(dir, 'backups') });
  const db = openStore(dbFile);
  upsertStudent(db, { student_hash: hashId('stu-1', SALT), dt_user_hash: hashId('u1', SALT), tier: 'pilot', entitled_until: '2099-12-31' }, new Date());
  db.close();

  const pack = path.join(dir, 'pack');
  mkdirSync(pack);
  const math = { ...PRACTICE[0]!, id: 'math1', stem: 'Find $x^2$ when $x=3$', options: ['$1$', '$9$', '$x$', 'none'], key: 1, solution: { text: 'Since $x=3$, $x^2=9$.', checked: true } };
  writeFileSync(path.join(pack, 'items.jsonl'), [...PRACTICE, math, ...MOCK_ITEMS].map((i) => JSON.stringify(i)).join('\n') + '\n');
  writeFileSync(path.join(pack, 'exam.json'), JSON.stringify({
    version: 'smoke-1', marking: GATE_LIKE, timing: { total_minutes: 180, total_marks: 100 }, section_marks: 15,
    topics: [{ id: 't1', label: 'Linear algebra', weight_marks: 6 }, { id: 't2', label: 'Calculus', weight_marks: 5 }], tiers: TIERS,
    mock: { form_version: 'f1', opens_on: '2020-01-01', closes_on: '2099-12-31', planned_close: '2099-12-31' },
  }));

  dt = createServer((req, res) => {
    const tok = /dt_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
    const user = tok.startsWith('tok-') ? tok.slice(4) : null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ enabled: true, authenticated: user !== null, user_id: user, is_admin: false }));
  });
  await new Promise<void>((r) => dt.listen(0, '127.0.0.1', r));
  brain = await startServer(
    { VIDHYA_DB: dbFile, PACK_DIR: pack, DEEPTUTOR_URL: `http://127.0.0.1:${(dt.address() as AddressInfo).port}`, VIDHYA_HASH_SALT: SALT, APP_ORIGIN: ORIGIN, PORT: '0', BUILD_ID: 'smoke-build', SYNC_TOKEN: 'smoke-sync-token' },
    { log: () => undefined },
  );
  base = `http://127.0.0.1:${brain.port}`;
  // Computed specifiers: the brain's typecheck (NodeNext) does not follow into the browser app's sources.
  HttpExamApi = (await import(/* @vite-ignore */ `${EXAM}/http.ts`)).HttpExamApi;
  ExamApiError = (await import(/* @vite-ignore */ `${EXAM}/errors.ts`)).ExamApiError;
});

afterAll(async () => {
  await brain?.close();
  await new Promise<void>((r) => dt?.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe('HttpExamApi against the real brain', () => {
  it('session, topics, Today and a KaTeX item, then a check with its rendered explanation and week count', async () => {
    const { api } = clientFor('u1', { buildId: 'smoke-build' });
    const s = await api.init();
    expect(s).toMatchObject({ flags: { exam_page: true, mock: true }, entitled: true, buildId: 'smoke-build' });
    expect((await api.listTopics()).map((t: { id: string }) => t.id)).toEqual(['t1', 't2']);
    const today = await api.getToday();
    expect(today.items.length).toBeGreaterThan(0);
    const item = await api.getItem('math1');
    expect(item.stemHtml).toContain('class="katex"');
    expect(item.options[1].html).toContain('class="katex"');
    const out = await api.checkAnswer('math1', { kind: 'mcq', key: 'B' });
    expect(out.status).toBe('checked');
    expect(out.result).toMatchObject({ outcome: 'correct', key: 'B', scored: 1 });
    expect(out.result.reasonHtml).toContain('class="katex"');
  });

  it('a mock from start to pre-close result, with the client\'s answers saved server-side', async () => {
    const { api } = clientFor('u1');
    const brief = await api.getMockBrief();
    expect(brief).toMatchObject({ phase: 'open', taken: 'none', questions: 15 });
    const attempt = await api.startMock();
    expect(attempt.items).toHaveLength(15);
    expect(attempt.items[0].stemHtml).toBe('Mock stem 1');
    expect(JSON.stringify(attempt)).not.toMatch(/SOLUTION-SENTINEL|solution|"correct"|"answer"/i); // no key before the mock closes
    await api.answerMock(attempt.attemptId, 'm1', { kind: 'mcq', key: 'B' }, false);
    await api.answerMock(attempt.attemptId, 'm2', { kind: 'mcq', key: 'A' }, true);
    await api.submitMock(attempt.attemptId);
    const res = await api.getMockResult(attempt.attemptId);
    expect(res).toMatchObject({ outOf: 15, right: 1, wrong: 1, skipped: 13 });
    await expect(api.getMockReview()).rejects.toMatchObject({ code: 'MockNotClosed' }); // errors map to ExamApiError
  });

  it('marks: after the mock there is a range of section_marks 15 and an honest taxonomy', async () => {
    const { api } = clientFor('u1');
    const m = await api.getMarks();
    expect(m.status).toBe('ok');
    expect(m.range.of).toBe(15);
    expect(m.basis).toMatch(/^estimate from \d+ attempts$/);
    expect(m.score).toMatchObject({ outOf: 15 });
  });

  it('a request without a session redirects to /v1/login with the return path', async () => {
    const { api, redirects } = clientFor(null);
    await expect(api.getToday()).rejects.toMatchObject({ code: 'SessionMissing' });
    expect(redirects).toEqual(['/v1/login?return=%2Fexam%2Fmock']);
    const login = await fetch(`${base}${redirects[0]}`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe('/login?return=%2Fexam%2Fmock');
  });

  it('the build id check fires when the brain\'s build differs from the app\'s', async () => {
    const { api } = clientFor('u1', { buildId: 'an-older-build' });
    let seen = '';
    api.onBuildMismatch((b: string) => { seen = b; });
    await api.listTopics();
    expect(seen).toBe('smoke-build');
  });

  it('when the brain is unreachable the client says so (DR8) and holds an offline check (DR5)', async () => {
    const live = clientFor('u1');
    await live.api.init();
    let down = false;
    const fetchImpl = (url: string, init: RequestInit = {}) => {
      if (down) return Promise.reject(new TypeError('fetch failed'));
      const headers = new Headers(init.headers);
      headers.set('cookie', 'dt_token=tok-u1');
      if (init.method && init.method !== 'GET') headers.set('origin', ORIGIN);
      return fetch(base + url, { ...init, headers });
    };
    const store: Record<string, string> = {};
    const api = new HttpExamApi({ fetchImpl, redirect: () => undefined, flushEveryMs: 0, onOnline: () => undefined, storage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } });
    await api.init();
    await api.getItem('p1');
    down = true;
    await expect(api.getToday()).rejects.toMatchObject({ code: 'Offline', down: true });
    expect(await api.checkAnswer('p1', { kind: 'mcq', key: 'B' })).toEqual({ status: 'queued' });
    down = false;
    const got: any[] = [];
    api.onQueuedResult((r: unknown) => got.push(r));
    await api.flush();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ itemId: 'p1', outcome: 'correct' });
    expect(api.waiting()).toBe(0);
  });
});

describe('vidhya sync\'s HttpServableSource against the real brain', () => {
  it('reads /v1/servable with the bearer secret: practice MCQ and MSQ only, with keys; wrong token refused', async () => {
    const { HttpServableSource } = await import(/* @vite-ignore */ `${SYNC}/servable.ts`);
    const ok = await new HttpServableSource(base, 'smoke-sync-token').fetch({ pool: 'practice', types: ['MCQ', 'MSQ'] });
    expect(ok.packVersion).toBe('smoke-1');
    expect(ok.items.map((i: { id: string }) => i.id).sort()).toEqual(['math1', 'p1', 'p2', 'p4']);
    expect(ok.items.every((i: { pool: string; type: string }) => i.pool === 'practice' && i.type !== 'NAT')).toBe(true);
    expect(ok.items.find((i: { id: string }) => i.id === 'p1')).toMatchObject({ key: 1 });
    await expect(new HttpServableSource(base, 'wrong').fetch({ pool: 'practice', types: ['MCQ'] })).rejects.toMatchObject({ code: 'BrainUnavailable' });
    await expect(new HttpServableSource(base, undefined).fetch({ pool: 'practice', types: ['MCQ'] })).rejects.toThrow(/401/);
  });
});
