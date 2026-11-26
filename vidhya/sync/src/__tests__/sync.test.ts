import { describe, expect, it } from 'vitest';
import { runSync } from '../sync.js';
import type { ApplierRequest, ApplierResponse, ApplierRunner, ServableSource } from '../types.js';
import { mcq, msq } from './fixtures.js';

const students = [{ student: 'hash-1', dtUserId: 'u_1' }];

function servable(items = [mcq('syn-001'), msq('syn-002')], packVersion = '0.0.1'): ServableSource {
  return { fetch: async () => ({ packVersion, items }) };
}

/** A fake applier that records requests and answers from a script. */
function applier(script: (req: ApplierRequest, n: number) => { code: number; body: ApplierResponse }) {
  const calls: ApplierRequest[] = [];
  const runner: ApplierRunner = {
    run: async (req) => {
      calls.push(req);
      return script(req, calls.length);
    },
  };
  return { calls, runner };
}

const okStudent = (over = {}) => ({ student: 'hash-1', status: 'ok' as const, inserted: 0, updated: 0, deleted: 0, plan_insert: 0, plan_update: 0, plan_remove: 0, ...over });
const ok = (students: object[]) => ({ code: 0, body: { ok: true, error: null, students } as ApplierResponse });

describe('runSync', () => {
  it('sends finished rows for every target, then runs a dry-run drift check', async () => {
    const a = applier((req) => ok([okStudent(req.mode === 'apply' ? { inserted: 2 } : {})]));
    const r = await runSync({ students }, { servable: servable(), applier: a.runner });
    expect(a.calls.map((c) => c.mode)).toEqual(['apply', 'dry-run']);
    expect(a.calls[0]!.students![0]!.rows.map((x) => x.id)).toEqual(['syn-001', 'syn-002']);
    expect(a.calls[0]!.students![0]!.rows[0]!.tag).toMatch(/^ledger:syn-001@[0-9a-f]{8}$/);
    expect(a.calls[0]!.update_mode).toBe('in-place');
    expect(a.calls[0]!.expected_version).toBe('1.7.3');
    expect(r.ok).toBe(true);
    expect(r.drift).toBe(0);
    expect(r.exitCode).toBe(0);
  });

  it('--dry-run applies nothing and skips the drift check', async () => {
    const a = applier(() => ok([okStudent({ status: 'dry-run', plan_insert: 2 })]));
    const r = await runSync({ students, dryRun: true }, { servable: servable(), applier: a.runner });
    expect(a.calls.map((c) => c.mode)).toEqual(['dry-run']);
    expect(r.dryRun).toBe(true);
    expect(r.students[0]!.plan_insert).toBe(2);
  });

  it('non-zero drift after the run is SyncDrift (exit 8)', async () => {
    const a = applier((req) => ok([okStudent(req.mode === 'dry-run' ? { plan_update: 1 } : {})]));
    const r = await runSync({ students }, { servable: servable(), applier: a.runner });
    expect(r.drift).toBe(1);
    expect(r.exitCode).toBe(8);
    expect(r.ok).toBe(false);
  });

  it('a skipped or failed student gives exit 1 and the others still report', async () => {
    const a = applier(() => ok([okStudent({ status: 'skipped', error: { code: 'SyncLockTimeout', message: 'busy' } })]));
    const r = await runSync({ students }, { servable: servable(), applier: a.runner });
    expect(r.exitCode).toBe(1);
  });

  it('--to must match the brain pack version, checked before anything is applied', async () => {
    const a = applier(() => ok([]));
    await expect(runSync({ students, to: '0.0.2' }, { servable: servable(), applier: a.runner })).rejects.toThrow(/PackVersionMismatch/);
    expect(a.calls).toHaveLength(0);
  });

  it('refuses an empty servable set unless --allow-mass-remove', async () => {
    const a = applier(() => ok([]));
    await expect(runSync({ students }, { servable: servable([]), applier: a.runner })).rejects.toThrow(/SyncMassRemoveRefused/);
    expect(a.calls).toHaveLength(0);
    await expect(runSync({ students, allowMassRemove: true }, { servable: servable([]), applier: a.runner })).resolves.toBeTruthy();
  });

  it('brain down aborts before the applier is called', async () => {
    const a = applier(() => ok([]));
    const down: ServableSource = {
      fetch: async () => {
        const { SyncError } = await import('../errors.js');
        throw new SyncError('BrainUnavailable', 'down');
      },
    };
    await expect(runSync({ students }, { servable: down, applier: a.runner })).rejects.toThrow(/BrainUnavailable/);
    expect(a.calls).toHaveLength(0);
  });

  it.each([
    ['SyncAlreadyRunning', 3],
    ['StoreSchemaMismatch', 4],
  ])('a run-level %s from the applier is surfaced by name', async (code) => {
    const a = applier(() => ({ code: 3, body: { ok: false, error: { code, message: 'x' }, students: [] } }));
    await expect(runSync({ students }, { servable: servable(), applier: a.runner })).rejects.toThrow(new RegExp(code));
  });

  it('passes the flags through: update mode, allow-mass-remove, paths, one student', async () => {
    const two = [...students, { student: 'hash-2', dtUserId: 'u_2' }];
    const a = applier(() => ok([okStudent()]));
    await runSync(
      { students: two, only: 'u_1', updateMode: 'delete-insert', allowMassRemove: true, lockPath: '/x/sync.lock', eventsPath: '/x/events.jsonl' },
      { servable: servable(), applier: a.runner },
    );
    const req = a.calls[0]!;
    expect(req.update_mode).toBe('delete-insert');
    expect(req.allow_mass_remove).toBe(true);
    expect(req.lock_path).toBe('/x/sync.lock');
    expect(req.events_path).toBe('/x/events.jsonl');
    expect(req.students!.map((s) => s.dt_user_id)).toEqual(['u_1']);
  });

  it('never sends a NAT or mock-pool item to a student bank', async () => {
    const a = applier(() => ok([okStudent()]));
    await expect(
      runSync({ students }, { servable: servable([mcq('syn-1', { pool: 'mock' })]), applier: a.runner }),
    ).rejects.toThrow(/InvalidItem/);
    expect(a.calls).toHaveLength(0);
  });
});
