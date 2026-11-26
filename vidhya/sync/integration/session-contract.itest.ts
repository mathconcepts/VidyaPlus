/**
 * Session contract (plan R1/R7, S1): the brain's REAL session resolver against a REAL
 * DeepTutor. A student logs in to DeepTutor; the brain forwards dt_token to /api/auth/status
 * and maps user_id -> student through the registry. Synthetic accounts only.
 */
import { describe, expect, it } from 'vitest';
import { makeSessionResolver } from '../../brain/src/session/resolve.js';

const BASE = `http://127.0.0.1:${process.env.DT_BACKEND_PORT ?? '8001'}`;
const USER = process.env.IT_STUDENT_USER ?? 'it-student-1';
const PASS = process.env.IT_STUDENT_PASS ?? 'it-student-pass-1234';

async function login(): Promise<{ cookie: string; userId: string }> {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
  expect(r.status).toBe(200);
  const token = /dt_token=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
  expect(token).toBeTruthy();
  const body = (await r.json()) as { user_id: string };
  return { cookie: `dt_token=${token}`, userId: body.user_id };
}

describe('brain session resolver against real DeepTutor', () => {
  it('maps a real dt_token to the enrolled student', async () => {
    const { cookie, userId } = await login();
    const resolve = makeSessionResolver({ authBase: BASE, lookupStudent: (u) => (u === userId ? 'synthetic-student' : undefined) });
    await expect(resolve(cookie)).resolves.toMatchObject({ studentId: 'synthetic-student', userId, isAdmin: false });
  });

  it('SessionMissing without a cookie, and for a tampered token', async () => {
    const { cookie } = await login();
    const resolve = makeSessionResolver({ authBase: BASE, lookupStudent: () => 'x' });
    await expect(resolve(undefined)).rejects.toThrow(/SessionMissing/);
    await expect(resolve(cookie.slice(0, -4) + 'AAAA')).rejects.toThrow(/SessionMissing/);
  });

  it('UnknownStudent when the DeepTutor account is not in the registry', async () => {
    const { cookie } = await login();
    const resolve = makeSessionResolver({ authBase: BASE, lookupStudent: () => undefined });
    await expect(resolve(cookie)).rejects.toThrow(/UnknownStudent/);
  });

  it('AuthUpstreamUnavailable when DeepTutor is unreachable', async () => {
    const { cookie } = await login();
    const resolve = makeSessionResolver({ authBase: 'http://127.0.0.1:9', lookupStudent: () => 'x', retryDelayMs: 1 });
    await expect(resolve(cookie)).rejects.toThrow(/AuthUpstreamUnavailable/);
  });
});
