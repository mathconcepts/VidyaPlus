import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openStore, backupTo, SCHEMA_VERSION } from '../db.js';
import { isBrainError } from '../../errors.js';

const fresh = () => path.join(mkdtempSync(path.join(tmpdir(), 'brain-db-')), 'brain.db');
const now = '2026-11-25T10:00:00Z';

function attempt(db: Database.Database, key: string, over: Record<string, unknown> = {}) {
  const row = { idempotency_key: key, student_hash: 's1', item_id: 'i1', fingerprint: 'fp1', pack_version: '0.1.0', context: 'practice',
    response_json: '{}', correct: 1, skipped: 0, marks_awarded: 1, marks_max: 1, elapsed_ms: 1000, source: 'brain', ts: now, ...over };
  return db.prepare(`INSERT INTO attempts (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => '@' + k).join(',')})`).run(row);
}

describe('store', () => {
  it('opens in WAL mode at the latest schema, and re-opening is a no-op', () => {
    const f = fresh();
    const db = openStore(f);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
    const again = openStore(f);
    expect((again.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
    again.close();
  });

  it('has the plan §15 S7 indexes', () => {
    const db = openStore(fresh());
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['attempts_student_ts', 'attempts_item_fp', 'item_status_item', 'disputes_item_day']));
  });

  it('a double tap returns the same attempt (idempotency key is unique)', () => {
    const db = openStore(fresh());
    attempt(db, 'k1');
    expect(() => attempt(db, 'k1')).toThrow(/UNIQUE/);
  });

  it('only one scored mock per student and form', () => {
    const db = openStore(fresh());
    const ins = db.prepare("INSERT INTO mocks (student_hash, form_version, state, started_at, deadline_at) VALUES ('s1','m1',?,?,?)");
    ins.run('scored', now, now);
    expect(() => ins.run('in_progress', now, now)).toThrow(/UNIQUE/);
    ins.run('practice_only', now, now);
  });

  it('one counted dispute per student per item; anonymous MCP reports are not limited by it', () => {
    const db = openStore(fresh());
    const ins = db.prepare("INSERT INTO disputes (item_id, fingerprint, student_hash, channel, note, day, counted, state, created_at) VALUES ('i1','fp',?,?,NULL,'2026-11-25',1,'open',?)");
    ins.run('s1', 'exam', now);
    expect(() => ins.run('s1', 'exam', now)).toThrow(/UNIQUE/);
    ins.run(null, 'mcp', now);
    ins.run(null, 'mcp', now);
    // after an errata the item has a new fingerprint, so the same student can report it again
    db.prepare("INSERT INTO disputes (item_id, fingerprint, student_hash, channel, note, day, counted, state, created_at) VALUES ('i1','fp2','s1','exam',NULL,'2026-11-26',1,'open',?)").run(now);
  });

  it('rejects a dispute note over 280 characters', () => {
    const db = openStore(fresh());
    expect(() =>
      db.prepare("INSERT INTO disputes (item_id, fingerprint, student_hash, channel, note, day, counted, state, created_at) VALUES ('i1','fp','s1','exam',?,'d',1,'open',?)").run('x'.repeat(281), now),
    ).toThrow(/CHECK/);
  });

  it('refuses a database from a newer brain (StoreSchemaMismatch)', () => {
    const f = fresh();
    openStore(f).close();
    const raw = new Database(f);
    raw.prepare("INSERT INTO schema_migrations VALUES (?, 'future', ?)").run(SCHEMA_VERSION + 1, now);
    raw.close();
    let err: unknown;
    try {
      openStore(f);
    } catch (e) {
      err = e;
    }
    expect(isBrainError(err, 'StoreSchemaMismatch')).toBe(true);
  });

  it('VACUUM INTO makes a restorable copy of a live WAL database', () => {
    const db = openStore(fresh());
    attempt(db, 'k1');
    const copy = fresh();
    backupTo(db, copy);
    const restored = openStore(copy);
    expect((restored.prepare('SELECT COUNT(*) n FROM attempts').get() as { n: number }).n).toBe(1);
  });
});
