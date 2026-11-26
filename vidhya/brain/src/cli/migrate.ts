/**
 * `vidhya migrate <db-path> <backup-dir>`: backup, then migrate. Prints what it did; exit 1 on
 * failure with the fix command (E13). Defaults: VIDHYA_DB and VIDHYA_BACKUP_DIR.
 */
import { runMigrations } from '../store/migrate.js';
import { isBrainError } from '../errors.js';

export async function runMigrateCli(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  const dbPath = argv[0] ?? env.VIDHYA_DB;
  const backupDir = argv[1] ?? env.VIDHYA_BACKUP_DIR;
  if (!dbPath || !backupDir) {
    err('usage: vidhya migrate <db-path> <backup-dir>   (or set VIDHYA_DB and VIDHYA_BACKUP_DIR)');
    return 1;
  }
  try {
    const r = await runMigrations(dbPath, { backupDir });
    if (r.applied.length === 0) out(`schema already current at version ${r.to}; nothing to do`);
    else out(`migrated ${r.from} -> ${r.to}: ${r.applied.join(', ')}\nbackup: ${r.backup}`);
    return 0;
  } catch (e) {
    const code = isBrainError(e) ? e.code : 'Unexpected';
    err(`migrate failed (${code}): ${(e as Error).message}`);
    err(`fix: the database was left at its previous version. Restore from the backup named above if needed, correct the migration, then re-run: vidhya migrate ${dbPath} ${backupDir}`);
    return 1;
  }
}
