import { describe, expect, it } from 'vitest';
import { hashId } from '../../../brain/src/registry/registry.js';
import { selectStudents } from '../sync.js';
import { resolveStudents } from '../students.js';

describe('resolveStudents', () => {
  const salt = 'test-salt';
  it('matches DeepTutor ids to registry rows by salted hash; the rest are unknown', () => {
    const s1 = hashId('u_one', salt);
    const reg = [{ student_hash: 'a'.repeat(64), dt_user_hash: hashId('u_enrolled', salt) }];
    const r = resolveStudents(['u_enrolled', 'u_stranger'], reg, salt);
    expect(r.enrolled).toEqual([{ student: 'a'.repeat(64), dtUserId: 'u_enrolled' }]);
    expect(r.unknown).toEqual(['u_stranger']);
    expect(s1).toHaveLength(64);
  });
});

describe('selectStudents (--student)', () => {
  const all = [
    { student: 'abc123', dtUserId: 'u_1' },
    { student: 'abd456', dtUserId: 'u_2' },
  ];
  it('returns all without a filter, one by DeepTutor id or hash prefix', () => {
    expect(selectStudents(all)).toHaveLength(2);
    expect(selectStudents(all, 'u_2')).toEqual([all[1]]);
    expect(selectStudents(all, 'abc')).toEqual([all[0]]);
  });
  it('UnknownStudent for no match or an ambiguous prefix', () => {
    expect(() => selectStudents(all, 'zzz')).toThrow(/UnknownStudent/);
    expect(() => selectStudents(all, 'ab')).toThrow(/UnknownStudent/);
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from '../../../brain/node_modules/better-sqlite3';
import { applyPending } from '../../../brain/src/store/migrate.js';
import { upsertStudent } from '../../../brain/src/registry/registry.js';
import { loadStudents } from '../students.js';
import type { ApplierRunner } from '../types.js';

describe('loadStudents', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-students-'));
  const users: ApplierRunner = { run: async () => ({ code: 0, body: { ok: true, error: null, users: ['u_enrolled', 'u_other'] } }) };

  it('reads a --students-file as is', async () => {
    const f = path.join(dir, 'students.json');
    writeFileSync(f, JSON.stringify([{ student: 'h', dt_user_id: 'u_1' }]));
    expect(await loadStudents({ studentsFile: f }, users, undefined, undefined)).toEqual({ students: [{ student: 'h', dtUserId: 'u_1' }], unknown: [] });
  });

  it('discovers users in the container and keeps only those the registry knows (UnknownStudent skipped)', async () => {
    const file = path.join(dir, 'brain.db');
    const db = new Database(file);
    applyPending(db);
    const student = 'b'.repeat(64);
    upsertStudent(db, { student_hash: student, dt_user_hash: hashId('u_enrolled', 'salt'), tier: 'free', entitled_until: '2099-01-01' }, new Date());
    db.close();
    const r = await loadStudents({ registry: file }, users, 'salt', undefined);
    expect(r.students).toEqual([{ student, dtUserId: 'u_enrolled' }]);
    expect(r.unknown).toEqual(['u_other']);
  });

  it('needs a salt with a registry', async () => {
    await expect(loadStudents({ registry: 'x' }, users, undefined, undefined)).rejects.toThrow(/InvalidRequest/);
  });
});
