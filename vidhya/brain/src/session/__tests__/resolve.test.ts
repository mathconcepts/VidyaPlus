import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeSessionResolver, readCookie, AUTH_COOKIE, AUTH_STATUS_PATH } from '../resolve.js';
import { isBrainError } from '../../errors.js';

type Reply = { status: number; body?: unknown } | 'throw';

function fakeAuth(replies: Reply[]) {
  const calls: { url: string; cookie: string | null }[] = [];
  const impl = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: String(url), cookie: new Headers(init?.headers).get('cookie') });
    const r = replies.length > 1 ? replies.shift()! : replies[0]!;
    if (r === 'throw') throw new Error('ECONNREFUSED');
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (user_id = 'u1') => ({ status: 200, body: { enabled: true, authenticated: true, user_id, is_admin: false } });
const registry = (id: string) => (id === 'u1' ? 's-hash-1' : undefined);

async function codeOf(p: Promise<unknown>) {
  const e = await p.catch((x: unknown) => x);
  return isBrainError(e) ? e.code : 'resolved';
}

describe('readCookie', () => {
  it('finds dt_token among other cookies', () => {
    expect(readCookie('a=1; dt_token=abc.def; b=2')).toBe('abc.def');
    expect(readCookie('xdt_token=1')).toBeUndefined();
    expect(readCookie('dt_token=')).toBeUndefined();
    expect(readCookie(undefined)).toBeUndefined();
  });
});

describe('session resolver', () => {
  it('forwards only the dt_token cookie to /api/auth/status and maps the student', async () => {
    const a = fakeAuth([ok()]);
    const resolve = makeSessionResolver({ authBase: 'http://deeptutor:8001', lookupStudent: registry, fetchImpl: a.impl });
    expect(await resolve('other=x; dt_token=T1')).toEqual({ studentId: 's-hash-1', userId: 'u1', isAdmin: false });
    expect(a.calls[0]).toEqual({ url: `http://deeptutor:8001${AUTH_STATUS_PATH}`, cookie: `${AUTH_COOKIE}=T1` });
  });

  it('caches an authenticated answer for 60 s, then asks again', async () => {
    const a = fakeAuth([ok()]);
    let t = 0;
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: a.impl, now: () => t });
    await resolve('dt_token=T');
    t = 59_000;
    await resolve('dt_token=T');
    expect(a.calls).toHaveLength(1);
    t = 61_000;
    await resolve('dt_token=T');
    expect(a.calls).toHaveLength(2);
  });

  it('no cookie → SessionMissing without calling DeepTutor', async () => {
    const a = fakeAuth([ok()]);
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: a.impl });
    expect(await codeOf(resolve('foo=1'))).toBe('SessionMissing');
    expect(a.calls).toHaveLength(0);
  });

  it('an expired token → SessionMissing, and is not cached', async () => {
    const a = fakeAuth([{ status: 200, body: { enabled: true, authenticated: false, user_id: null } }]);
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: a.impl });
    expect(await codeOf(resolve('dt_token=old'))).toBe('SessionMissing');
    expect(await codeOf(resolve('dt_token=old'))).toBe('SessionMissing');
    expect(a.calls).toHaveLength(2);
  });

  it('a DeepTutor account that is not enrolled → UnknownStudent', async () => {
    const a = fakeAuth([ok('u9')]);
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: a.impl });
    expect(await codeOf(resolve('dt_token=T'))).toBe('UnknownStudent');
  });

  it('AUTH_ENABLED=false → AuthDisabled unless explicitly allowed for local dev', async () => {
    const off = { status: 200, body: { enabled: false, authenticated: true, user_id: 'local-admin', is_admin: true } };
    const strict = makeSessionResolver({ authBase: 'http://d', lookupStudent: () => 'x', fetchImpl: fakeAuth([off]).impl });
    expect(await codeOf(strict('dt_token=T'))).toBe('AuthDisabled');
    const dev = makeSessionResolver({ authBase: 'http://d', lookupStudent: () => 'x', fetchImpl: fakeAuth([off]).impl, allowAuthDisabled: true });
    expect(await codeOf(dev('dt_token=T'))).toBe('resolved');
  });

  it('5xx or network failure retries twice, then AuthUpstreamUnavailable', async () => {
    const a = fakeAuth([{ status: 503 }, 'throw', { status: 502 }]);
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: a.impl, retryDelayMs: 1 });
    expect(await codeOf(resolve('dt_token=T'))).toBe('AuthUpstreamUnavailable');
    expect(a.calls).toHaveLength(3);
  });

  it('a recovered upstream on the retry still resolves', async () => {
    const a = fakeAuth([{ status: 503 }, ok()]);
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: a.impl, retryDelayMs: 1 });
    expect(await codeOf(resolve('dt_token=T'))).toBe('resolved');
  });

  it.each([
    [{ status: 200, body: { ok: true } }],
    [{ status: 200, body: { enabled: 'yes', authenticated: true, user_id: 'u1' } }],
    [{ status: 404, body: {} }],
  ])('a changed response shape → AuthContractBroken (%j)', async (reply) => {
    const resolve = makeSessionResolver({ authBase: 'http://d', lookupStudent: registry, fetchImpl: fakeAuth([reply]).impl });
    expect(await codeOf(resolve('dt_token=T'))).toBe('AuthContractBroken');
  });
});

describe('pinned DeepTutor still matches what this resolver reads (T15)', () => {
  it('scripts/upstream/check-auth-contract.py passes on upstream/deeptutor', () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
    let out = '';
    try {
      out = execFileSync('python3', ['-I', path.join(repo, 'scripts/upstream/check-auth-contract.py'), path.join(repo, 'upstream/deeptutor')], { encoding: 'utf8' });
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stdout?: string };
      if (err.code === 'ENOENT') return;
      throw new Error(err.stdout || err.message);
    }
    expect(out).toContain('OK');
  });
});
