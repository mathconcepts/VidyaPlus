/**
 * Identity for every /exam/api request (plan R1, R7-1). The brain forwards the
 * student's own `dt_token` cookie to DeepTutor's GET /api/auth/status over
 * loopback, caches the answer for 60 s, and maps DeepTutor's user_id to a
 * Vidhya student through the registry. No handler takes a student id from a
 * request body or from MCP arguments.
 *
 * The contract read here is pinned by scripts/upstream/check-auth-contract.py,
 * which runs on every DeepTutor upgrade (T15).
 */
import { createHash } from 'node:crypto';
import { BrainError } from '../errors.js';

export const AUTH_COOKIE = 'dt_token';
export const AUTH_STATUS_PATH = '/api/auth/status';

export interface Session {
  studentId: string;
  userId: string;
  isAdmin: boolean;
}

export interface ResolveDeps {
  /** DeepTutor base URL on the loopback/docker network, e.g. http://deeptutor:8001 */
  authBase: string;
  /** user_id → Vidhya student id (registry, v5 P4). */
  lookupStudent: (userId: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  /** Only for local development: DeepTutor with AUTH_ENABLED=false answers "local-admin" for everyone. */
  allowAuthDisabled?: boolean;
  retryDelayMs?: number;
}

interface StatusBody {
  enabled: boolean;
  authenticated: boolean;
  user_id: string | null;
  is_admin?: boolean;
}

export function readCookie(header: string | undefined, name = AUTH_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return v.length > 0 ? v : undefined;
    }
  }
  return undefined;
}

function checkShape(raw: unknown): StatusBody {
  const o = raw as Record<string, unknown> | null;
  if (
    !o ||
    typeof o.enabled !== 'boolean' ||
    typeof o.authenticated !== 'boolean' ||
    !(o.user_id === null || o.user_id === undefined || typeof o.user_id === 'string')
  ) {
    throw new BrainError('AuthContractBroken', '/api/auth/status response no longer has enabled, authenticated, user_id');
  }
  return {
    enabled: o.enabled,
    authenticated: o.authenticated,
    user_id: (o.user_id as string | null | undefined) ?? null,
    is_admin: o.is_admin === true,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeSessionResolver(deps: ResolveDeps) {
  const f = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const ttl = deps.cacheTtlMs ?? 60_000;
  const cache = new Map<string, { at: number; body: StatusBody }>();

  async function fetchStatus(token: string): Promise<StatusBody> {
    let lastDetail = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(deps.retryDelayMs ?? 200);
      let res: Response;
      try {
        res = await f(new URL(AUTH_STATUS_PATH, deps.authBase), {
          headers: { cookie: `${AUTH_COOKIE}=${token}`, accept: 'application/json' },
        });
      } catch (e) {
        lastDetail = e instanceof Error ? e.message : 'network error';
        continue;
      }
      if (res.status >= 500) {
        lastDetail = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new BrainError('AuthContractBroken', `/api/auth/status answered HTTP ${res.status}`);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new BrainError('AuthContractBroken', '/api/auth/status did not return JSON');
      }
      return checkShape(json);
    }
    throw new BrainError('AuthUpstreamUnavailable', lastDetail || 'DeepTutor auth unreachable');
  }

  return async function resolve(cookieHeader: string | undefined): Promise<Session> {
    const token = readCookie(cookieHeader);
    if (!token) throw new BrainError('SessionMissing', 'no dt_token cookie');
    const key = createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    let body: StatusBody;
    if (hit && now() - hit.at < ttl) {
      body = hit.body;
    } else {
      body = await fetchStatus(token);
      if (body.authenticated) cache.set(key, { at: now(), body });
      else cache.delete(key);
    }
    if (!body.enabled && !deps.allowAuthDisabled) {
      throw new BrainError('AuthDisabled', 'DeepTutor runs with AUTH_ENABLED=false; the brain refuses to serve students');
    }
    if (!body.authenticated || !body.user_id) throw new BrainError('SessionMissing', 'dt_token is not a valid session');
    const studentId = deps.lookupStudent(body.user_id);
    if (!studentId) throw new BrainError('UnknownStudent', 'this DeepTutor account is not enrolled');
    return { studentId, userId: body.user_id, isAdmin: body.is_admin === true };
  };
}
