import { describe, it, expect, afterEach } from 'vitest';
import { harness, PRACTICE, MOCK_ITEMS, type Harness } from './harness.js';
import { isInternalAddress } from '../internal.js';
import { fileDispute } from '../../disputes/disputes.js';
import { fingerprint } from '../../item/schema.js';
import { buildPack } from '../../pack/pack.js';
import { GATE_LIKE } from '../../scoring/__tests__/fixtures.js';
import { TIERS } from './harness.js';
import { studentHash, T0 } from './harness.js';

let h: Harness;
afterEach(async () => { await h?.close(); });
const TOKEN = 'sync-secret-for-tests';
const auth = { authorization: `Bearer ${TOKEN}` };
const get = (q = '?pool=practice&type=MCQ,MSQ', headers: Record<string, string> = auth) => h.call('GET', `/v1/servable${q}`, { as: 'nobody', headers });

describe('GET /v1/servable (internal, for vidhya sync)', () => {
  it('serves the practice MCQ and MSQ items with their keys, in the body the sync command reads', async () => {
    h = await harness({ syncToken: TOKEN });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.json.pack_version).toBe('pack-test-1');
    expect(r.json.items.map((i: { id: string }) => i.id)).toEqual(['p1', 'p2', 'p4']);
    expect(r.json.items[0]).toMatchObject({ id: 'p1', pool: 'practice', type: 'MCQ', key: 1, options: ['a', 'b', 'c', 'd'] });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('never serves a mock-pool item, whatever the query says', async () => {
    h = await harness({ syncToken: TOKEN });
    expect((await get('?pool=mock&type=MCQ,MSQ')).status).toBe(400);
    expect((await get('?pool=diagnostic&type=MCQ')).status).toBe(400);
    expect((await get('')).status).toBe(400);
    const all = await get('?pool=practice&type=MCQ,MSQ,NAT');
    expect(all.json.items.every((i: { pool: string }) => i.pool === 'practice')).toBe(true);
    expect(all.text).not.toMatch(/MOCK-SOLUTION-SENTINEL|"id":"m\d/);
    expect(MOCK_ITEMS.length).toBeGreaterThan(0);
  });
  it('leaves out retired items and items under an open dispute overlay', async () => {
    const retired = { ...PRACTICE[0]!, id: 'p9', status: 'retired' as const };
    const pack = buildPack({ version: 'v', marking: GATE_LIKE, timing: { total_minutes: 180, total_marks: 100 }, topics: [], tiers: TIERS, items: [...PRACTICE, retired] });
    h = await harness({ syncToken: TOKEN, pack, withMockForm: false });
    expect((await get()).json.items.map((i: { id: string }) => i.id)).not.toContain('p9');
    // two reporters reach the quorum and quarantine p2
    for (const s of ['s1', 's2'] as const) fileDispute(h.db, { item_id: 'p2', fingerprint: fingerprint(pack.byId.get('p2')!), student_hash: studentHash(s), channel: 'exam' }, T0);
    const ids = (await get()).json.items.map((i: { id: string }) => i.id);
    expect(ids).toContain('p1');
    expect(ids).not.toContain('p2');
  });
  it('refuses without the bearer token, with a wrong one, and with a non-Bearer scheme', async () => {
    h = await harness({ syncToken: TOKEN });
    expect((await get('?pool=practice&type=MCQ', {})).json).toMatchObject({ code: 'SyncUnauthorized' });
    expect((await get('?pool=practice&type=MCQ', { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await get('?pool=practice&type=MCQ', { authorization: `Basic ${TOKEN}` })).status).toBe(401);
    expect((await get('?pool=practice&type=MCQ', { authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
  });
  it('a student cookie is not a credential', async () => {
    h = await harness({ syncToken: TOKEN });
    const r = await h.call('GET', '/v1/servable?pool=practice&type=MCQ', { as: 's1' });
    expect(r.status).toBe(401);
  });
  it('refuses a request that arrived through a proxy (forwarding header), even with the token', async () => {
    h = await harness({ syncToken: TOKEN });
    for (const hdr of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
      const r = await get('?pool=practice&type=MCQ', { ...auth, [hdr]: '203.0.113.9' });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('SyncForbidden');
    }
  });
  it('is off when SYNC_TOKEN is not set, and POST is not allowed', async () => {
    h = await harness();
    expect((await get()).json).toMatchObject({ code: 'SyncNotConfigured' });
    await h.close();
    h = await harness({ syncToken: TOKEN });
    expect((await h.call('POST', '/v1/servable', { as: 'nobody', headers: auth, body: {} })).status).toBe(405);
  });
  it('a pinned --to version that is not what the brain serves is a 409', async () => {
    h = await harness({ syncToken: TOKEN });
    expect((await get('?pool=practice&type=MCQ&version=pack-test-1')).status).toBe(200);
    const r = await get('?pool=practice&type=MCQ&version=pack-other');
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('PackVersionMismatch');
  });
});

describe('isInternalAddress', () => {
  it('accepts loopback and private ranges, refuses public addresses', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.1', '192.168.1.1', 'fd00::1', 'fe80::1']) expect(isInternalAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.9', '2001:db8::1', '', undefined, 'not-an-ip']) expect(isInternalAddress(a as string | undefined), String(a)).toBe(false);
  });
});
