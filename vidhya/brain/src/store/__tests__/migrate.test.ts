import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations, assertSchemaCurrent, currentVersion } from '../migrate.js';
import { MIGRATIONS } from '../migrations.js';
import { isBrainError } from '../../errors.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'brain-mig-'));

describe('runMigrations (E13)', () => {
  it('backs up first, applies all migrations, and a second run is a no-op', async () => {
    const dir = tmp();
    const dbPath = path.join(dir, 'b.db');
    const r = await runMigrations(dbPath, { backupDir: path.join(dir, 'bk') });
    expect(r.applied).toEqual(MIGRATIONS.map((m) => m.name));
    expect(r.backup && existsSync(r.backup)).toBe(true);
    const again = await runMigrations(dbPath, { backupDir: path.join(dir, 'bk') });
    expect(again).toMatchObject({ applied: [], backup: null });
    const db = new Database(dbPath);
    expect(() => assertSchemaCurrent(db)).not.toThrow();
    db.close();
  });

  it('a broken migration leaves the DB at the previous version, with a backup on disk', async () => {
    const dir = tmp();
    const dbPath = path.join(dir, 'b.db');
    await runMigrations(dbPath, { backupDir: path.join(dir, 'bk') });
    const before = MIGRATIONS[MIGRATIONS.length - 1]!.version;
    const broken = [
      ...MIGRATIONS,
      { version: before + 1, name: '999_broken', sql: 'CREATE TABLE half_done (x INTEGER); INSERT INTO no_such_table VALUES (1);' },
    ];
    let err: unknown;
    try {
      await runMigrations(dbPath, { backupDir: path.join(dir, 'bk2'), migrations: broken });
    } catch (e) {
      err = e;
    }
    expect(isBrainError(err, 'MigrationFailed')).toBe(true);
    const db = new Database(dbPath);
    expect(currentVersion(db)).toBe(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='half_done'").get()).toBeUndefined(); // rolled back
    expect(() => assertSchemaCurrent(db, broken)).toThrow(/SchemaBehind/);
    db.close();
    expect(readdirSync(path.join(dir, 'bk2')).length).toBe(1);
  });

  it('assertSchemaCurrent refuses an old schema with the fix command', () => {
    const db = new Database(':memory:');
    let err: unknown;
    try { assertSchemaCurrent(db); } catch (e) { err = e; }
    expect(isBrainError(err, 'SchemaBehind')).toBe(true);
    expect((err as Error).message).toContain('vidhya migrate');
  });
});
