/** Test harness: a real brain HTTP server on a random port beside a stub DeepTutor auth server. Synthetic data only. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openStore, type Db } from '../../store/db.js';
import { hashId, upsertStudent } from '../../registry/registry.js';
import { buildPack, type Pack } from '../../pack/pack.js';
import { fingerprint, type Item } from '../../item/schema.js';
import { makeDeps, type Deps } from '../../service/deps.js';
import { makeSessionResolver } from '../../session/resolve.js';
import { registerForm } from '../../mock/attempts.js';
import { renderOnSync } from '../../render/index.js';
import { createApp, type AppConfig } from '../app.js';
import { GATE_LIKE } from '../../scoring/__tests__/fixtures.js';

export const ORIGIN = 'https://learn.test';
export const SALT = 'salt';
export const T0 = new Date('2026-12-13T09:00:00Z');
export const min = (n: number) => n * 60_000;
export const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

export const PRACTICE_SOLUTION = 'PRACTICE-SOLUTION-SENTINEL';
export const MOCK_SOLUTION = 'MOCK-SOLUTION-SENTINEL';
export const RECEIPT_VALUE = 'RECEIPT-VALUE-SENTINEL';

const common = { answer_kind: 'options' as const, topic_id: 't1', concept_id: 'c1', status: 'verified' as const, since_version: 'v0' };
function withReceipt(item: Item): Item {
  return { ...item, receipt: { method: 'sympy recompute + wolfram', engines: [{ name: 'SymPy', result: RECEIPT_VALUE }, 'Wolfram'], agree: true, reviewer: 'reviewer-1', reviewed_at: '2026-11-20', fingerprint: fingerprint(item), values: { answer: RECEIPT_VALUE } } };
}
const prac = (o: Partial<Item> & Pick<Item, 'id' | 'type' | 'key' | 'marks'>): Item =>
  withReceipt({ ...common, pool: 'practice', stem: `Practice stem ${o.id} <b>x</b>`, solution: { text: `${PRACTICE_SOLUTION} ${o.id}`, checked: true }, ...o });

export const PRACTICE: Item[] = [
  prac({ id: 'p1', type: 'MCQ', marks: 1, options: ['a', 'b', 'c', 'd'], key: 1 }),
  prac({ id: 'p2', type: 'MSQ', marks: 2, options: ['a', 'b', 'c', 'd'], key: [0, 3] }),
  prac({ id: 'p3', type: 'NAT', marks: 1, key: '2', nat_range: [1.9, 2.1], answer_kind: 'number' }),
  prac({ id: 'p4', type: 'MCQ', marks: 2, options: ['a', 'b', 'c'], key: 2, topic_id: 't2' }),
];
export const MOCK_ITEMS: Item[] = Array.from({ length: 15 }, (_, i): Item => ({
  ...common, id: `m${i + 1}`, pool: 'mock', topic_id: 'topic-secret', concept_id: 'concept-secret',
  type: i === 2 ? 'NAT' : 'MCQ', answer_kind: i === 2 ? 'number' : 'options', marks: 1,
  stem: `Mock stem ${i + 1}`, options: i === 2 ? undefined : ['a', 'b', 'c', 'd'], key: i === 2 ? '2' : 1, nat_range: i === 2 ? [1.9, 2.1] : undefined,
  solution: { text: `${MOCK_SOLUTION} m${i + 1}`, checked: true },
  receipt: { method: 'x', engines: ['SymPy'], agree: true, fingerprint: 'f' },
}));

export const TIERS = {
  pilot: { exam_page: true, nat: true, mock: true, today_card: true, disputes: true, tutor_mcp: true },
  free: { exam_page: true, nat: false, mock: false, today_card: true, disputes: true, tutor_mcp: false },
};

export function makePack(opts: { mockItems?: Item[] } = {}): Pack {
  return buildPack({
    version: 'pack-test-1', marking: GATE_LIKE, timing: { total_minutes: 180, total_marks: 100 },
    topics: [{ id: 't1', label: 'Linear algebra', weight_marks: 6 }, { id: 't2', label: 'Calculus', weight_marks: 5 }],
    tiers: TIERS, mock: { form_version: 'f1', opens_on: '2026-12-13', closes_on: '2026-12-20', planned_close: '2026-12-20' },
    items: [...PRACTICE, ...(opts.mockItems ?? MOCK_ITEMS)],
  });
}

export const hashOf = (n: string) => hashId(n, SALT);
export const USERS: Record<string, { user: string; tier: string; until: string | null }> = {
  s1: { user: 'u1', tier: 'pilot', until: '2026-12-31' },
  s2: { user: 'u2', tier: 'pilot', until: '2026-12-31' },
  expired: { user: 'u3', tier: 'pilot', until: '2026-12-13' },
  free: { user: 'u4', tier: 'free', until: '2026-12-31' },
};
export const studentHash = (key: keyof typeof USERS) => hashId(`stu-${key}`, SALT);

export interface Harness {
  db: Db;
  pack: Pack;
  deps: Deps;
  clock: { now: Date };
  base: string;
  authCalls: string[];
  authMode: { value: 'ok' | 'down' };
  close: () => Promise<void>;
  call: (method: string, path: string, o?: { as?: keyof typeof USERS | 'nobody' | string; body?: unknown; origin?: string | null; raw?: string; contentType?: string | null; headers?: Record<string, string> }) => Promise<{ status: number; headers: Headers; json: any; text: string }>;
}

export async function harness(opts: { pack?: Pack; rateLimit?: number; withMockForm?: boolean; render?: boolean; syncToken?: string } = {}): Promise<Harness> {
  const db = openStore(':memory:');
  const pack = opts.pack ?? makePack();
  for (const [k, u] of Object.entries(USERS)) {
    upsertStudent(db, { student_hash: studentHash(k), dt_user_hash: hashId(u.user, SALT), tier: u.tier, entitled_until: u.until }, T0);
  }
  if (opts.render !== false) renderOnSync(db, pack.items, { now: T0 }); // what runtime boot does
  const deps = makeDeps(db, pack);
  if (opts.withMockForm !== false) {
    registerForm(db, { form_version: 'f1', items: pack.items.filter((i) => i.pool === 'mock'), timing: pack.timing, planned_close: '2026-12-20' }, T0);
  }
  const clock = { now: T0 };
  const authCalls: string[] = [];
  const authMode: { value: 'ok' | 'down' } = { value: 'ok' };
  const dt: Server = createServer((req, res) => {
    authCalls.push(req.headers.cookie ?? '');
    if (authMode.value === 'down') { res.writeHead(503); res.end(); return; }
    const tok = /dt_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
    const user = tok.startsWith('tok-') ? tok.slice(4) : null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ enabled: true, authenticated: user !== null, user_id: user, is_admin: false }));
  });
  await new Promise<void>((r) => dt.listen(0, '127.0.0.1', r));
  const dtUrl = `http://127.0.0.1:${(dt.address() as AddressInfo).port}`;

  const lookup = db.prepare('SELECT student_hash FROM registry WHERE dt_user_hash = ?');
  const resolveSession = makeSessionResolver({
    authBase: dtUrl, retryDelayMs: 1, cacheTtlMs: 0,
    lookupStudent: (u) => (lookup.get(hashId(u, SALT)) as { student_hash: string } | undefined)?.student_hash,
  });
  const config: AppConfig = { appOrigin: ORIGIN, loginPath: '/login', buildId: 'build-test', deeptutorUrl: dtUrl, rateLimitPerMinute: opts.rateLimit, syncToken: opts.syncToken };
  const { server } = createApp({ deps, config, resolveSession, now: () => clock.now, log: () => undefined });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: Harness['call'] = async (method, path, o = {}) => {
    const headers: Record<string, string> = {};
    if (o.as !== 'nobody') {
      const key = o.as ?? 's1';
      const user = USERS[key]?.user ?? key;
      headers.cookie = `dt_token=tok-${user}`;
    }
    Object.assign(headers, o.headers);
    if (method !== 'GET' && o.origin !== null) headers.origin = o.origin ?? ORIGIN;
    let body: string | undefined;
    if (o.raw !== undefined) body = o.raw;
    else if (o.body !== undefined) body = JSON.stringify(o.body);
    if (body !== undefined && o.contentType !== null) headers['content-type'] = o.contentType ?? 'application/json';
    const r = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, headers: r.headers, json, text };
  };
  return {
    db, pack, deps, clock, base, authCalls, authMode, call,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await new Promise<void>((r) => dt.close(() => r()));
      db.close();
    },
  };
}

export const mcqAns = (key: string) => ({ kind: 'mcq' as const, key });
export const natAns = (raw: string) => ({ kind: 'nat' as const, raw });
