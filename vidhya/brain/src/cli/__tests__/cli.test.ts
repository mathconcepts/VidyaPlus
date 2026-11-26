import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrationsForTest, writePackDir } from './util.js';
import { runMockCli } from '../mock.js';
import { runMigrateCli } from '../migrate.js';
import { main } from '../vidhya.js';
import { parseArgs } from '../args.js';
import { openRuntime, ensureMockForm } from '../../runtime.js';
import { startMock, submitMock } from '../../service/mock.js';
import { hashId, upsertStudent } from '../../registry/registry.js';
import { T0, at, min, SALT, MOCK_ITEMS } from '../../http/__tests__/harness.js';
import { startServer } from '../../server.js';
import { MIGRATIONS } from '../../store/migrations.js';
import { applyPending } from '../../store/migrate.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'vidhya-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const S1 = hashId('cli-student-1', SALT);
const run = (argv: string[], now: Date, extra: Record<string, string> = {}) => {
  const out: string[] = []; const err: string[] = [];
  const env = { VIDHYA_DB: path.join(dir, 'b.db'), PACK_DIR: path.join(dir, 'pack'), ...extra };
  const code = runMockCli(argv, env, (s) => out.push(s), (s) => err.push(s), () => now);
  return { code, out: out.join('\n'), err: err.join('\n') };
};

async function setup() {
  await runMigrationsForTest(path.join(dir, 'b.db'), path.join(dir, 'bk'));
  writePackDir(path.join(dir, 'pack'));
  const env = { VIDHYA_DB: path.join(dir, 'b.db'), PACK_DIR: path.join(dir, 'pack') };
  const rt = openRuntime(env);
  upsertStudent(rt.db, { student_hash: S1, dt_user_hash: hashId('cli-dt-1', SALT), tier: 'pilot', entitled_until: '2026-12-31' }, T0);
  expect(ensureMockForm(rt, T0)).toBe('ready');
  return rt;
}

describe('args', () => {
  it('parses positionals and --flag value / --flag=value; a flag with no value is an error', () => {
    expect(parseArgs(['close', 'f1', '--actor', 'a', '--reason=x y'])).toEqual({ pos: ['close', 'f1'], flags: { actor: 'a', reason: 'x y' } });
    expect(() => parseArgs(['reset', '--reason'])).toThrow(/needs a value/);
  });
});

describe('vidhya mock close', () => {
  it('is refused while an attempt window is open (E6), then closes, audits, and is idempotent', async () => {
    const rt = await setup();
    const a = startMock(rt.deps, S1, T0);
    expect(a.items).toHaveLength(15);
    rt.db.close();
    const early = run(['close', 'f1'], at(T0, min(5)));
    expect(early.code).toBe(1);
    expect(early.err).toContain('MockCloseTooEarly');
    const ok = run(['close', 'f1', '--actor', 'giri'], at(T0, min(27) + 120_000));
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ form_version: 'f1', auto_closed: 1, already_closed: false });
    const db = new Database(path.join(dir, 'b.db'));
    expect(db.prepare("SELECT action, actor, form_version FROM mock_audit").all()).toEqual([{ action: 'close', actor: 'giri', form_version: 'f1' }]);
    db.close();
    expect(JSON.parse(run(['close', 'f1'], at(T0, min(40))).out).already_closed).toBe(true);
    expect(run(['close', 'nope'], at(T0, min(40))).err).toContain('MockFormUnknown');
  });
});

describe('vidhya mock reset', () => {
  it('needs a reason and a real student hash; reopens an attempt an outage covered; writes an audit row with the reason', async () => {
    const rt = await setup();
    startMock(rt.deps, S1, T0);
    submitMock(rt.deps, S1, 1, at(T0, min(40))); // the server closed it at the window end; nobody could sync
    rt.db.close();
    expect(run(['reset', S1], at(T0, min(41))).err).toContain('needs --reason');
    expect(run(['reset', S1, '--reason', '   '], at(T0, min(41))).code).toBe(1);
    expect(run(['reset', 'not-a-hash', '--reason', 'outage'], at(T0, min(41))).err).toContain('64-hex');
    const ok = run(['reset', S1, '--reason', 'host outage 09:05 to 09:40', '--actor', 'giri'], at(T0, min(41)));
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ attempt_id: 1 });
    const db = new Database(path.join(dir, 'b.db'));
    expect(db.prepare('SELECT action, actor, reason, student_hash FROM mock_audit').all()).toEqual([
      { action: 'reset', actor: 'giri', reason: 'host outage 09:05 to 09:40', student_hash: S1 },
    ]);
    expect(db.prepare('SELECT state FROM mocks').get()).toEqual({ state: 'in_progress' });
    db.close();
  });
  it('refuses a student with no scored attempt', async () => {
    const rt = await setup();
    rt.db.close();
    const r = run(['reset', S1, '--reason', 'outage'], at(T0, min(1)));
    expect(r.code).toBe(1);
    expect(r.err).toContain('MockNotResettable');
  });
});

describe('the vidhya dispatcher and migrate', () => {
  it('usage, unknown commands, and mock argument errors exit non-zero', async () => {
    expect(await main(['bogus'])).toBe(1);
    expect(runMockCli(['close'], {}, () => undefined, () => undefined)).toBe(1);
    expect(runMockCli(['wat', 'x'], {}, () => undefined, () => undefined)).toBe(1);
    expect(run(['close', 'f1'], T0, { VIDHYA_DB: '' }).code).toBe(1);
  });
  it('migrate takes a backup, applies, and a second run does nothing', async () => {
    const db = path.join(dir, 'c.db');
    const out: string[] = [];
    expect(await runMigrateCli([db, path.join(dir, 'bk')], {}, (s) => out.push(s), () => undefined)).toBe(0);
    expect(out[0]).toContain(`-> ${MIGRATIONS.length}`);
    expect(await runMigrateCli([db, path.join(dir, 'bk')], {}, (s) => out.push(s), () => undefined)).toBe(0);
    expect(out[1]).toContain('nothing to do');
    expect(await runMigrateCli([], {}, () => undefined, () => undefined)).toBe(1);
    expect(readdirSync(path.join(dir, 'bk')).length).toBe(1); // one backup, taken by the first run only
  });
  it('an old schema is refused by mock commands with SchemaBehind (E13)', () => {
    const f = path.join(dir, 'old.db');
    const raw = new Database(f);
    applyPending(raw, MIGRATIONS.filter((m) => m.version <= 4));
    raw.close();
    writePackDir(path.join(dir, 'pack'));
    const r = run(['close', 'f1'], T0, { VIDHYA_DB: f });
    expect(r.code).toBe(1);
    expect(r.err).toContain('SchemaBehind');
    expect(r.err).toContain('vidhya migrate');
  });
});

describe('E13: the server never migrates and refuses an old schema', () => {
  const env = () => ({
    VIDHYA_DB: path.join(dir, 'b.db'), PACK_DIR: path.join(dir, 'pack'), DEEPTUTOR_URL: 'http://127.0.0.1:9', VIDHYA_HASH_SALT: SALT,
    APP_ORIGIN: 'https://learn.test', PORT: '0', BUILD_ID: 'b1',
  });
  it('refuses to start on a database behind by a migration, and leaves it untouched', async () => {
    const f = path.join(dir, 'b.db');
    const raw = new Database(f);
    applyPending(raw, MIGRATIONS.filter((m) => m.version <= 4));
    raw.close();
    writePackDir(path.join(dir, 'pack'));
    await expect(startServer(env(), { log: () => undefined })).rejects.toMatchObject({ code: 'SchemaBehind' });
    const check = new Database(f);
    expect(check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: 4 });
    check.close();
  });
  it('starts on a current schema, registers the mock form and serves /health', async () => {
    await runMigrationsForTest(path.join(dir, 'b.db'), path.join(dir, 'bk'));
    writePackDir(path.join(dir, 'pack'));
    const s = await startServer(env(), { log: () => undefined });
    try {
      const r = await fetch(`http://127.0.0.1:${s.port}/health`);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, mock_form: 'ready', pack_version: 'pack-test-1', build_id: 'b1', deeptutor_auth_reachable: false });
    } finally {
      await s.close();
    }
  });
  it('a pack whose mock form is under the 15-item floor leaves the mock unavailable but still boots', async () => {
    await runMigrationsForTest(path.join(dir, 'b.db'), path.join(dir, 'bk'));
    writePackDir(path.join(dir, 'pack'), MOCK_ITEMS.slice(0, 10));
    const s = await startServer(env(), { log: () => undefined });
    try {
      expect((await (await fetch(`http://127.0.0.1:${s.port}/health`)).json()).mock_form).toBe('unavailable');
    } finally {
      await s.close();
    }
  });
  it('needs its settings: a missing one is a named error, not a crash', async () => {
    await expect(startServer({}, { log: () => undefined })).rejects.toMatchObject({ code: 'BadRequest' });
    writeFileSync(path.join(dir, 'x'), '');
  });
});
