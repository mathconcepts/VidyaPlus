import { describe, it, expect } from 'vitest';
import { openStore } from '../../store/db.js';
import {
  fileDispute, hiddenItemIdsFor, openOverlayRows, isStormPaused, adminQuarantine, adminRestore, adminReviewQueue,
  type DisputeInput,
} from '../disputes.js';
import { isServable, type Item } from '../../item/schema.js';
import { isBrainError } from '../../errors.js';

const FP = 'a'.repeat(64);
const T0 = new Date('2026-12-01T10:00:00Z');
const stu = (n: number) => `s${n}`;
const rep = (n: number, item: string, over: Partial<DisputeInput> = {}): DisputeInput => ({
  item_id: item, fingerprint: FP, student_hash: stu(n), channel: 'exam', ...over,
});
const status = (db: ReturnType<typeof openStore>, item: string) =>
  db.prepare("SELECT COUNT(*) n FROM item_status WHERE item_id=? AND status='disputed' AND closed_at IS NULL").get(item) as { n: number };

describe('B6 quorum (O2)', () => {
  it('one report hides the item for the reporter only; no cohort quarantine', () => {
    const db = openStore(':memory:');
    expect(fileDispute(db, rep(1, 'i1'), T0).outcome).toBe('hidden_for_reporter');
    expect(hiddenItemIdsFor(db, stu(1)).has('i1')).toBe(true);
    expect(hiddenItemIdsFor(db, stu(2)).has('i1')).toBe(false);
    expect(status(db, 'i1').n).toBe(0);
  });
  it('the same student twice does not make a quorum', () => {
    const db = openStore(':memory:');
    fileDispute(db, rep(1, 'i1'), T0);
    expect(fileDispute(db, rep(1, 'i1'), T0).outcome).toBe('duplicate');
    expect(status(db, 'i1').n).toBe(0);
  });
  it('2 distinct students quarantine the cohort, with an audit row', () => {
    const db = openStore(':memory:');
    fileDispute(db, rep(1, 'i1'), T0);
    expect(fileDispute(db, rep(2, 'i1'), T0).outcome).toBe('quarantined');
    expect(status(db, 'i1').n).toBe(1);
    expect(db.prepare('SELECT action, actor FROM overlay_audit').all()).toEqual([{ action: 'quarantine_quorum', actor: 'system' }]);
    const item: Item = {
      id: 'i1', pool: 'practice', type: 'MCQ', answer_kind: 'options', marks: 1, topic_id: 't', concept_id: 'c', stem: 's',
      options: ['a', 'b'], key: 0, solution: { text: 't', checked: true }, status: 'verified', since_version: '0',
    };
    // the overlay row is keyed to the fingerprint used in the reports, so servable agrees once they match
    expect(openOverlayRows(db)).toEqual([{ item_id: 'i1', fingerprint: FP, status: 'disputed', closed_at: null }]);
    expect(isServable(item, openOverlayRows(db))).toBe(true); // different fingerprint: not this version
  });
  it('reports on different fingerprints do not combine', () => {
    const db = openStore(':memory:');
    fileDispute(db, rep(1, 'i1'), T0);
    fileDispute(db, rep(2, 'i1', { fingerprint: 'b'.repeat(64) }), T0);
    expect(status(db, 'i1').n).toBe(0);
  });
});

describe('storm rule (plan §9)', () => {
  it('12 reports on 2 items: both quarantined, no storm', () => {
    const db = openStore(':memory:');
    let last;
    for (let n = 1; n <= 6; n++) {
      fileDispute(db, rep(n, 'iA'), T0);
      last = fileDispute(db, rep(n, 'iB'), T0);
    }
    expect(status(db, 'iA').n).toBe(1);
    expect(status(db, 'iB').n).toBe(1);
    expect(last!.storm).toBe(false);
    expect(isStormPaused(db, T0)).toBe(false);
  });
  it('6 distinct items: storm flag, alert fired once, auto-quarantine paused', () => {
    const db = openStore(':memory:');
    const alerts: unknown[] = [];
    const onStorm = (e: unknown) => alerts.push(e);
    const results = [];
    for (let k = 1; k <= 6; k++) results.push(fileDispute(db, rep(k, `i${k}`), T0, { onStorm })); // students s1..s6, one item each
    expect(results.slice(0, 5).every((r) => !r.storm)).toBe(true);
    expect(results[5]!.storm).toBe(true);
    expect(alerts).toEqual([{ day: '2026-12-01', distinct_items: 6 }]);
    // a second reporter on an item now would make quorum, but the pause holds it back
    const r = fileDispute(db, rep(7, 'i1'), T0, { onStorm });
    expect(r).toMatchObject({ outcome: 'hidden_for_reporter', storm: true });
    expect(status(db, 'i1').n).toBe(0);
    expect(alerts.length).toBe(1);
    // next UTC day the pause lifts
    expect(isStormPaused(db, new Date('2026-12-02T01:00:00Z'))).toBe(false);
  });
  it('a throwing alert hook is reported, not swallowed, and the dispute is kept', () => {
    const db = openStore(':memory:');
    let r;
    for (let k = 1; k <= 6; k++) r = fileDispute(db, rep(k, `i${k}`), T0, { onStorm: () => { throw new Error('down'); } });
    expect(r!.alert_failed).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM disputes').get()).toEqual({ n: 6 });
  });
});

describe('MCP reports (O2)', () => {
  it('never quarantine, never count toward quorum or storm', () => {
    const db = openStore(':memory:');
    for (let k = 0; k < 20; k++) expect(fileDispute(db, { item_id: `i${k % 8}`, fingerprint: FP, student_hash: null, channel: 'mcp' }, T0).outcome).toBe('queued_for_review');
    expect(db.prepare('SELECT COUNT(*) n FROM item_status').get()).toEqual({ n: 0 });
    expect(isStormPaused(db, T0)).toBe(false);
    // one anonymous plus one identified is still not a quorum
    fileDispute(db, { item_id: 'iX', fingerprint: FP, student_hash: null, channel: 'mcp' }, T0);
    fileDispute(db, rep(1, 'iX'), T0);
    expect(status(db, 'iX').n).toBe(0);
  });
  it('rejects mismatched identity and channel', () => {
    const db = openStore(':memory:');
    for (const bad of [{ ...rep(1, 'i1'), channel: 'mcp' as const }, { ...rep(1, 'i1'), student_hash: null }]) {
      try { fileDispute(db, bad, T0); expect.unreachable(); } catch (e) { expect(isBrainError(e, 'InvalidDispute')).toBe(true); }
    }
  });
});

describe('abuse cap', () => {
  it('the 4th dispute in a UTC day is logged but not counted, and does not hide', () => {
    const db = openStore(':memory:');
    for (const i of ['a', 'b', 'c']) fileDispute(db, rep(1, i), T0);
    const r = fileDispute(db, rep(1, 'd'), T0);
    expect(r.outcome).toBe('rate_limited');
    expect(hiddenItemIdsFor(db, stu(1)).has('d')).toBe(false);
    expect(db.prepare("SELECT counted, state FROM disputes WHERE item_id='d'").get()).toEqual({ counted: 0, state: 'logged_only' });
    // a second student reporting d is then only one counted reporter
    fileDispute(db, rep(2, 'd'), T0);
    expect(status(db, 'd').n).toBe(0);
  });
  it('the cap resets on the next UTC day', () => {
    const db = openStore(':memory:');
    for (const i of ['a', 'b', 'c']) fileDispute(db, rep(1, i), T0);
    expect(fileDispute(db, rep(1, 'd'), new Date('2026-12-02T00:00:01Z')).outcome).toBe('hidden_for_reporter');
  });
});

describe('notes and admin', () => {
  it('rejects notes over 280 chars, accepts 280', () => {
    const db = openStore(':memory:');
    expect(fileDispute(db, rep(1, 'i1', { note: 'x'.repeat(280) }), T0).outcome).toBe('hidden_for_reporter');
    try { fileDispute(db, rep(2, 'i1', { note: 'x'.repeat(281) }), T0); expect.unreachable(); } catch (e) { expect(isBrainError(e, 'InvalidDispute')).toBe(true); }
  });
  it('no student-facing function returns the note', () => {
    const db = openStore(':memory:');
    fileDispute(db, rep(1, 'i1', { note: 'secret-note-text' }), T0);
    const out = JSON.stringify([...hiddenItemIdsFor(db, stu(1))]) + JSON.stringify(openOverlayRows(db)) + JSON.stringify(fileDispute(db, rep(2, 'i1'), T0));
    expect(out).not.toContain('secret-note-text');
    expect(JSON.stringify(adminReviewQueue(db))).toContain('secret-note-text');
  });
  it('admin quarantine and restore are audited, append-only', () => {
    const db = openStore(':memory:');
    expect(adminQuarantine(db, { item_id: 'i1', fingerprint: FP, actor: 'giri', reason: 'wrong key' }, T0)).toBe(true);
    expect(adminQuarantine(db, { item_id: 'i1', fingerprint: FP, actor: 'giri', reason: 'again' }, T0)).toBe(false);
    expect(adminRestore(db, { item_id: 'i1', fingerprint: FP, actor: 'giri', reason: 'rechecked' }, T0)).toBe(true);
    expect(openOverlayRows(db)).toEqual([]);
    expect(db.prepare('SELECT action FROM overlay_audit ORDER BY id').all()).toEqual([{ action: 'quarantine_admin' }, { action: 'restore_admin' }]);
    expect(() => db.prepare("UPDATE overlay_audit SET actor='x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM overlay_audit').run()).toThrow(/append-only/);
  });
});
