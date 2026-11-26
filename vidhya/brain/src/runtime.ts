/** Shared boot for the server and the admin CLI: strict store (never migrates, E13) + the pack. */
import { BrainError } from './errors.js';
import { openStoreChecked, type Db } from './store/db.js';
import { loadPack, type Pack } from './pack/pack.js';
import { makeDeps, type Deps } from './service/deps.js';
import { registerForm } from './mock/attempts.js';

export type Env = Record<string, string | undefined>;

export function need(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new BrainError('BadRequest', `${name} is not set`);
  return v;
}

export interface Runtime {
  db: Db;
  pack: Pack;
  deps: Deps;
}

/** Opens the DB (refuses with SchemaBehind on an old schema) and loads the pack. */
export function openRuntime(env: Env, over: { db?: string; pack?: string } = {}): Runtime {
  const db = openStoreChecked(over.db ?? need(env, 'VIDHYA_DB'));
  try {
    const pack = loadPack(over.pack ?? need(env, 'PACK_DIR'));
    return { db, pack, deps: makeDeps(db, pack) };
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * Registers the pack's mock form (idempotent). Returns 'unavailable' instead of throwing when the form
 * is invalid (for example under the 15-item floor): the brain keeps serving everything else and /health
 * says so, because refusing to boot in mock week would be worse (E10).
 */
export function ensureMockForm(rt: Runtime, now: Date, log: (m: string) => void = () => undefined): 'ready' | 'unavailable' | 'none' {
  const c = rt.pack.mock;
  if (!c) return 'none';
  try {
    registerForm(rt.db, { form_version: c.form_version, items: rt.pack.items.filter((i) => i.pool === 'mock'), timing: rt.pack.timing, planned_close: c.planned_close }, now);
    return 'ready';
  } catch (e) {
    log(`mock form ${c.form_version} unavailable: ${(e as Error).message}`);
    return 'unavailable';
  }
}
