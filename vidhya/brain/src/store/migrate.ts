/**
 * E13: migrations are their own deploy step (`vidhya migrate`), not a boot side
 * effect. Order: online backup, then each pending migration in its own
 * transaction. The server calls `assertSchemaCurrent` at boot and refuses to
 * start on an old schema, so a failed migration leaves the old brain serving.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { BrainError } from '../errors.js';
import { MIGRATIONS } from './migrations.js';

type Migration = { version: number; name: string; sql: string };
type Db = Database.Database;

export interface MigrateResult {
  from: number;
  to: number;
  applied: string[];
  backup: string | null;
}

function ensureTable(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
}

export function currentVersion(db: Db): number {
  ensureTable(db);
  return (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
}

export function pendingMigrations(db: Db, migrations: readonly Migration[] = MIGRATIONS): Migration[] {
  const current = currentVersion(db);
  return migrations.filter((m) => m.version > current);
}

/** Apply pending migrations, each in its own transaction. No backup: callers that need one use runMigrations. */
export function applyPending(db: Db, migrations: readonly Migration[] = MIGRATIONS): string[] {
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  const current = currentVersion(db);
  if (current > latest) {
    throw new BrainError('StoreSchemaMismatch', `database is at schema ${current}, this brain knows up to ${latest}`);
  }
  const applied: string[] = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    try {
      db.transaction(() => {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
      })();
    } catch (e) {
      throw new BrainError('MigrationFailed', `${m.name} failed and was rolled back: ${(e as Error).message}`);
    }
    applied.push(m.name);
  }
  return applied;
}

/** Throws SchemaBehind when pending migrations exist; the server calls this at boot. */
export function assertSchemaCurrent(db: Db, migrations: readonly Migration[] = MIGRATIONS): void {
  const pending = pendingMigrations(db, migrations);
  if (pending.length > 0) {
    throw new BrainError(
      'SchemaBehind',
      `database is behind by ${pending.length} migration(s) (${pending.map((m) => m.name).join(', ')}); run: vidhya migrate`,
    );
  }
}

export async function runMigrations(
  dbPath: string,
  opts: { backupDir: string; migrations?: readonly Migration[]; now?: Date },
): Promise<MigrateResult> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    const from = currentVersion(db);
    const pending = pendingMigrations(db, migrations);
    if (pending.length === 0) return { from, to: from, applied: [], backup: null };
    mkdirSync(opts.backupDir, { recursive: true });
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
    const backup = path.join(opts.backupDir, `${path.basename(dbPath)}.v${from}.${stamp}.bak`);
    await db.backup(backup); // online backup: safe on a live WAL database
    try {
      const applied = applyPending(db, migrations);
      return { from, to: currentVersion(db), applied, backup };
    } catch (e) {
      if (e instanceof BrainError) throw new BrainError(e.code, `${(e as Error).message.replace(/^[A-Za-z]+: /, '')} (backup at ${backup})`);
      throw e;
    }
  } finally {
    db.close();
  }
}
