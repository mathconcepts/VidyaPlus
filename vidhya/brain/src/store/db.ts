/**
 * B3 store: SQLite in WAL mode beside DeepTutor (plan D8). Back up with
 * `.backup` / `VACUUM INTO`, never a raw file copy of a WAL database.
 */
import Database from 'better-sqlite3';
import { BrainError } from '../errors.js';
import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function openStore(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const current = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
  if (current > SCHEMA_VERSION) {
    throw new BrainError('StoreSchemaMismatch', `database is at schema ${current}, this brain knows up to ${SCHEMA_VERSION}`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    })();
  }
}

/** Online backup of a live WAL database (plan D8, T13). */
export function backupTo(db: Db, target: string): void {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
}
