/**
 * B3 store: SQLite in WAL mode beside DeepTutor (plan D8). Back up with
 * `.backup` / `VACUUM INTO`, never a raw file copy of a WAL database.
 */
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';
import { applyPending, assertSchemaCurrent } from './migrate.js';

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

/** Dev and test convenience: apply pending migrations. Production uses `vidhya migrate` (E13). */
export function migrate(db: Db): void {
  applyPending(db);
}

/** Online backup of a live WAL database (plan D8, T13). */
export function backupTo(db: Db, target: string): void {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
}

/**
 * Production open (E13): never migrates. Refuses with SchemaBehind when migrations are
 * pending, so a failed `vidhya migrate` leaves the old brain serving.
 */
export function openStoreChecked(file: string): Db {
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    assertSchemaCurrent(db);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
