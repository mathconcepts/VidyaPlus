/**
 * `vidhya migrate`: backup, then migrate. Prints what it did; exits 1 on
 * failure with the fix command (E13).
 * Usage: node dist/cli/migrate.js <db-path> <backup-dir>
 */
import { runMigrations } from '../store/migrate.js';
import { isBrainError } from '../errors.js';

async function main(argv: string[]): Promise<number> {
  const [dbPath, backupDir] = argv;
  if (!dbPath || !backupDir) {
    console.error('usage: migrate <db-path> <backup-dir>');
    return 1;
  }
  try {
    const r = await runMigrations(dbPath, { backupDir });
    if (r.applied.length === 0) console.log(`schema already current at version ${r.to}; nothing to do`);
    else console.log(`migrated ${r.from} -> ${r.to}: ${r.applied.join(', ')}\nbackup: ${r.backup}`);
    return 0;
  } catch (e) {
    const code = isBrainError(e) ? e.code : 'Unexpected';
    console.error(`migrate failed (${code}): ${(e as Error).message}`);
    console.error(`fix: the database was left at its previous version. Restore from the backup named above if needed, correct the migration, then re-run: vidhya migrate ${dbPath} ${backupDir}`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
