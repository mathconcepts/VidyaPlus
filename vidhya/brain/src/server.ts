/**
 * `npm start`: the Exam Brain HTTP + MCP server.
 * Env: VIDHYA_DB, PACK_DIR, DEEPTUTOR_URL, VIDHYA_HASH_SALT, APP_ORIGIN (required);
 *      SYNC_TOKEN (bearer for GET /v1/servable; unset turns that route off);
 *      PORT (8080), HOST (127.0.0.1), LOGIN_PATH (/login), BUILD_ID (dev).
 * It never migrates: run `vidhya migrate` first. On an old schema it refuses to start (E13).
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { createApp } from './http/app.js';
import { makeSessionResolver } from './session/resolve.js';
import { hashId } from './registry/registry.js';
import { ensureMockForm, need, openRuntime, type Env } from './runtime.js';
import { isBrainError } from './errors.js';

export interface Started {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(env: Env, opts: { fetchImpl?: typeof fetch; log?: (l: Record<string, unknown>) => void } = {}): Promise<Started> {
  const rt = openRuntime(env);
  const log = opts.log ?? ((l) => process.stderr.write(`${JSON.stringify(l)}\n`));
  for (const f of rt.render.failed) log({ level: 'warn', msg: 'item not renderable, not served', item_id: f.item_id, code: f.code, detail: f.message });
  ensureMockForm(rt, new Date(), (m) => log({ level: 'warn', msg: m }));
  const salt = need(env, 'VIDHYA_HASH_SALT');
  const lookup = rt.db.prepare('SELECT student_hash FROM registry WHERE dt_user_hash = ?');
  const deeptutorUrl = need(env, 'DEEPTUTOR_URL');
  const resolveSession = makeSessionResolver({
    authBase: deeptutorUrl,
    lookupStudent: (userId) => (lookup.get(hashId(userId, salt)) as { student_hash: string } | undefined)?.student_hash,
    fetchImpl: opts.fetchImpl,
  });
  const { server } = createApp({
    deps: rt.deps,
    resolveSession,
    log,
    fetchImpl: opts.fetchImpl,
    config: { appOrigin: need(env, 'APP_ORIGIN'), loginPath: env.LOGIN_PATH ?? '/login', buildId: env.BUILD_ID ?? 'dev', deeptutorUrl, syncToken: env.SYNC_TOKEN || undefined },
  });
  const host = env.HOST ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(env.PORT ?? 8080), host, resolve);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  log({ msg: 'brain listening', host, port, pack_version: rt.pack.version });
  return {
    server, port,
    close: () => new Promise<void>((resolve) => { server.close(() => { rt.db.close(); resolve(); }); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  startServer(process.env).catch((e: unknown) => {
    console.error(`brain did not start (${isBrainError(e) ? e.code : 'Unexpected'}): ${(e as Error).message}`);
    process.exit(1);
  });
}
