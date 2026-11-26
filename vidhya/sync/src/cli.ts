#!/usr/bin/env node
/**
 * vidhya sync [--student <id>] [--to <version>] [--dry-run] [--allow-mass-remove]
 *             [--update-mode in-place|delete-insert]
 *
 * Environment / flags:
 *   --brain <url>            brain base URL (VIDHYA_BRAIN_URL), bearer in VIDHYA_BRAIN_TOKEN
 *   --servable-file <path>   read the servable set from a JSON file instead (fixtures, offline)
 *   --container <name>       DeepTutor container (VIDHYA_DT_CONTAINER, default deeptutor)
 *   --docker "sudo docker"   docker command prefix
 *   --students-file <path>   [{"student": "...", "dt_user_id": "..."}]; else registry discovery:
 *   --registry <sqlite>      brain registry DB; with VIDHYA_ID_SALT, DeepTutor users found in the container
 *                            are matched by hash. Users with no registry row are skipped (UnknownStudent).
 * Exit: 0 ok, 1 a student failed/skipped, 3 SyncAlreadyRunning, 4 StoreSchemaMismatch, 5 other,
 *       6 BrainUnavailable, 7 SyncMassRemoveRefused, 8 SyncDrift.
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { DockerExecRunner } from './docker-applier.js';
import { isSyncError, SyncError } from './errors.js';
import { HttpServableSource, FileServableSource } from './servable.js';
import { loadStudents } from './students.js';
import { exitCodeFor, runSync } from './sync.js';
import type { ServableSource, UpdateMode } from './types.js';

async function main(): Promise<number> {
  const { values: v } = parseArgs({
    options: {
      student: { type: 'string' },
      to: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'allow-mass-remove': { type: 'boolean', default: false },
      'update-mode': { type: 'string', default: 'in-place' },
      brain: { type: 'string' },
      'servable-file': { type: 'string' },
      container: { type: 'string' },
      docker: { type: 'string' },
      'students-file': { type: 'string' },
      registry: { type: 'string' },
      'data-root': { type: 'string' },
      script: { type: 'string' },
      'expected-version': { type: 'string' },
      'lock-path': { type: 'string' },
      'events-path': { type: 'string' },
      'applier-env': { type: 'string', multiple: true },
    },
  });
  if (v['update-mode'] !== 'in-place' && v['update-mode'] !== 'delete-insert') {
    throw new SyncError('InvalidRequest', '--update-mode is in-place or delete-insert');
  }
  const brain = v.brain ?? process.env.VIDHYA_BRAIN_URL;
  let servable: ServableSource;
  if (v['servable-file']) servable = new FileServableSource(v['servable-file']);
  else if (brain) servable = new HttpServableSource(brain, process.env.VIDHYA_BRAIN_TOKEN);
  else throw new SyncError('InvalidRequest', 'give --brain <url> (VIDHYA_BRAIN_URL) or --servable-file');

  const applier = new DockerExecRunner(
    v.container ?? process.env.VIDHYA_DT_CONTAINER ?? 'deeptutor',
    v.script,
    (v.docker ?? process.env.VIDHYA_DOCKER ?? 'docker').split(/\s+/),
    // Test hooks only (VIDHYA_SYNC_TEST_FAULT / _RAISE): `--applier-env K=V`.
    Object.fromEntries((v['applier-env'] ?? []).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])),
  );
  const { students, unknown } = await loadStudents(
    { studentsFile: v['students-file'], registry: v.registry },
    applier,
    process.env.VIDHYA_ID_SALT,
    v['data-root'],
  );
  const report = await runSync(
    {
      students,
      only: v.student,
      to: v.to,
      dryRun: v['dry-run'],
      allowMassRemove: v['allow-mass-remove'],
      updateMode: v['update-mode'] as UpdateMode,
      dataRoot: v['data-root'],
      expectedVersion: v['expected-version'],
      lockPath: v['lock-path'],
      eventsPath: v['events-path'],
    },
    { servable, applier },
  );
  process.stdout.write(JSON.stringify({ ...report, skipped_unknown_users: unknown.length }, null, 2) + '\n');
  return report.exitCode;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(JSON.stringify({ ok: false, error: { code: isSyncError(e) ? e.code : 'Error', message: String((e as Error).message) } }) + '\n');
    process.exit(exitCodeFor(e));
  },
);
