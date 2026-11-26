import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SyncError } from './errors.js';
import { hashId } from '../../brain/src/registry/registry.js';
import type { ApplierRunner, StudentRef } from './types.js';

export interface RegistryLink {
  student_hash: string;
  dt_user_hash: string;
}

/**
 * DeepTutor user ids found on disk -> enrolled students. The registry stores
 * only salted hashes (R1, v5 P4), so an id is matched by hashing it. Ids with no
 * registry row (the admin, strangers) come back as `unknown`: skipped, UnknownStudent.
 */
export function resolveStudents(
  dtUserIds: readonly string[],
  registry: readonly RegistryLink[],
  salt: string,
): { enrolled: StudentRef[]; unknown: string[] } {
  const byDt = new Map(registry.map((r) => [r.dt_user_hash, r.student_hash]));
  const enrolled: StudentRef[] = [];
  const unknown: string[] = [];
  for (const id of dtUserIds) {
    const hit = byDt.get(hashId(id, salt));
    if (hit) enrolled.push({ student: hit, dtUserId: id });
    else unknown.push(id);
  }
  return { enrolled, unknown };
}

export async function loadStudents(
  args: { studentsFile?: string; registry?: string },
  applier: ApplierRunner,
  salt: string | undefined,
  dataRoot: string | undefined,
): Promise<{ students: StudentRef[]; unknown: string[] }> {
  if (args.studentsFile) {
    const raw = JSON.parse(await readFile(args.studentsFile, 'utf8')) as { student: string; dt_user_id: string }[];
    return { students: raw.map((r) => ({ student: r.student, dtUserId: r.dt_user_id })), unknown: [] };
  }
  if (!args.registry || !salt) {
    throw new SyncError('InvalidRequest', 'give --students-file, or --registry with VIDHYA_ID_SALT');
  }
  const users = await applier.run({ mode: 'users', data_root: dataRoot });
  if (users.body.error || !users.body.users) throw new SyncError('ApplierFailed', users.body.error?.message ?? 'users listing failed');
  // better-sqlite3 lives in the brain package; load it from there.
  // src/cli.ts -> ../../brain ; dist/sync/src/cli.js -> ../../../../brain ; or VIDHYA_BRAIN_DIR.
  const brainDir = [process.env.VIDHYA_BRAIN_DIR, '../../brain', '../../../../brain']
    .filter((x): x is string => !!x)
    .map((x) => (x.startsWith('.') ? fileURLToPath(new URL(x, import.meta.url)) : x))
    .find((d) => existsSync(`${d}/package.json`));
  if (!brainDir) throw new SyncError('InvalidRequest', 'cannot find vidhya/brain (set VIDHYA_BRAIN_DIR)');
  const req = createRequire(`${brainDir}/package.json`);
  const Database = req('better-sqlite3') as new (p: string, o?: object) => {
    prepare(sql: string): { all(): unknown[] };
    close(): void;
  };
  const db = new Database(args.registry, { readonly: true });
  try {
    const rows = db.prepare('SELECT student_hash, dt_user_hash FROM registry').all() as { student_hash: string; dt_user_hash: string }[];
    const { enrolled, unknown } = resolveStudents(users.body.users, rows, salt);
    return { students: enrolled, unknown };
  } finally {
    db.close();
  }
}

