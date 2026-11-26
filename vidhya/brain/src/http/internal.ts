/**
 * Routes that are NOT the student surface: reachable only from loopback or the internal network, and
 * only with a bearer token. Today: GET /v1/servable for the `vidhya sync` command.
 *
 * Why two locks: the bearer stops anything on the internal network that is not the sync job; the
 * address check stops the public path. Caddy proxies /exam/* only, but if it ever proxied this route the
 * request would arrive from Caddy's private address WITH a forwarding header, so a forwarding header is
 * refused too. With no SYNC_TOKEN configured the route does not exist.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { BrainError } from '../errors.js';

export const SERVABLE_PATH = '/v1/servable';

/** Loopback, RFC 1918, link-local and unique-local addresses (docker/internal networks). */
export function isInternalAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  if (a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [o1, o2] = [Number(v4[1]), Number(v4[2])];
    return o1 === 127 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254);
  }
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

const FORWARDED = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];

function bearerOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Throws unless the request may use an internal route. Order: configured, then network, then token. */
export function requireInternal(req: IncomingMessage, token: string | undefined): void {
  if (!token) throw new BrainError('SyncNotConfigured', 'this route is off: SYNC_TOKEN is not set');
  if (!isInternalAddress(req.socket.remoteAddress) || FORWARDED.some((h) => req.headers[h] !== undefined)) {
    throw new BrainError('SyncForbidden', 'this route is reachable only from the internal network');
  }
  if (!bearerOk(req.headers.authorization, token)) throw new BrainError('SyncUnauthorized', 'a valid bearer token is required');
}
