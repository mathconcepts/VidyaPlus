import { describe, it, expect } from 'vitest';
import { openStore } from '../../store/db.js';
import { hashId, upsertStudent, getStudent, isEntitled, flagsFor, entitledAt, type TierTemplate } from '../registry.js';
import { isBrainError } from '../../errors.js';

const T: TierTemplate = {
  pilot: { exam_page: true, nat: true, mock: true, today_card: true, disputes: true, tutor_mcp: true },
  basic: { exam_page: true, nat: false, mock: false, today_card: true, disputes: true, tutor_mcp: false },
};
const s = hashId('syn-user-1', 'salt');
const row = (over = {}) => ({ student_hash: s, dt_user_hash: hashId('dt-1', 'salt'), tier: 'pilot', entitled_until: '2026-12-31' as string | null, ...over });
const at = (d: string) => new Date(`${d}T10:00:00Z`);

describe('registry', () => {
  it('hashes ids and never stores raw ones', () => {
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(hashId('syn-user-1', 'other')).not.toBe(s);
    const db = openStore(':memory:');
    upsertStudent(db, row(), at('2026-12-01'));
    expect(JSON.stringify(db.prepare('SELECT * FROM registry').all())).not.toContain('syn-user-1');
  });
  it('upsert updates entitled_until', () => {
    const db = openStore(':memory:');
    upsertStudent(db, row(), at('2026-12-01'));
    upsertStudent(db, row({ entitled_until: '2027-03-31' }), at('2026-12-15'));
    expect(getStudent(db, s).entitled_until).toBe('2027-03-31');
    expect(db.prepare('SELECT COUNT(*) c FROM registry').get()).toEqual({ c: 1 });
  });
  it.each([
    ['raw id as hash', { student_hash: 'syn-user-1' }],
    ['impossible date', { entitled_until: '2026-02-31' }],
    ['malformed date', { entitled_until: '31/12/2026' }],
    ['empty tier', { tier: '' }],
  ])('rejects %s', (_n, over) => {
    const db = openStore(':memory:');
    try { upsertStudent(db, row(over), at('2026-12-01')); expect.unreachable(); } catch (e) { expect(isBrainError(e, 'InvalidRegistryRow')).toBe(true); }
  });
  it('unknown student is a named error', () => {
    const db = openStore(':memory:');
    try { getStudent(db, 'x'); expect.unreachable(); } catch (e) { expect(isBrainError(e, 'UnknownStudent')).toBe(true); }
  });
});

describe('entitlement and flags (DR7)', () => {
  it.each([
    ['2026-12-30', true], ['2026-12-31', true], ['2027-01-01', false],
  ])('on %s entitled=%s (inclusive end date)', (d, want) => {
    expect(entitledAt({ entitled_until: '2026-12-31' }, at(d))).toBe(want);
  });
  it('null entitled_until is not entitled', () => {
    expect(entitledAt({ entitled_until: null }, at('2026-12-01'))).toBe(false);
  });
  it('isEntitled reads the registry', () => {
    const db = openStore(':memory:');
    upsertStudent(db, row(), at('2026-12-01'));
    expect(isEntitled(db, s, at('2026-12-31'))).toBe(true);
    expect(isEntitled(db, s, at('2027-01-02'))).toBe(false);
  });
  it('entitled student gets the tier flags as written', () => {
    expect(flagsFor(row({ tier: 'basic' }), at('2026-12-20'), T)).toEqual(T.basic);
  });
  it('expired student keeps exam_page (history) and loses every new-work flag', () => {
    expect(flagsFor(row(), at('2027-02-01'), T)).toEqual({
      exam_page: true, nat: false, mock: false, today_card: false, disputes: false, tutor_mcp: false,
    });
  });
  it('a tier with exam_page off stays off after expiry', () => {
    const t = { off: { ...T.pilot!, exam_page: false } };
    expect(flagsFor(row({ tier: 'off' }), at('2027-02-01'), t).exam_page).toBe(false);
  });
  it.each([['missing tier', row({ tier: 'nope' }), T], ['incomplete flags', row(), { pilot: { exam_page: true } as never }]])(
    '%s -> UnknownTier',
    (_n, r, tpl) => {
      try { flagsFor(r, at('2026-12-01'), tpl as TierTemplate); expect.unreachable(); } catch (e) { expect(isBrainError(e, 'UnknownTier')).toBe(true); }
    },
  );
});
