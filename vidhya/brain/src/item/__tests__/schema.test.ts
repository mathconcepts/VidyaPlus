import { describe, it, expect } from 'vitest';
import { gradingFp, fingerprint, fp8, ledgerTag, parseLedgerTag, isServable, normaliseForFingerprint, type Item } from '../schema.js';
import { isBrainError } from '../../errors.js';

const base: Item = {
  id: 'syn-001', pool: 'practice', type: 'MCQ', answer_kind: 'options', marks: 1, topic_id: 't1', concept_id: 'c1',
  stem: 'Evaluate $\\frac{a}{b} + x$ for the sample.', options: ['1', '2', '3', '4'], key: 1,
  solution: { text: 'Add the terms, then simplify.', checked: true }, status: 'verified', since_version: '0.1.0',
};
const with_ = (o: Partial<Item>): Item => ({ ...base, ...o });

describe('fingerprints', () => {
  it('whitespace-only and spacing-command edits keep both hashes', () => {
    const edited = with_({
      stem: '  Evaluate   $\\frac{ a }{ b }  \\, +\\\x3b x$ for the\n sample. ',
      options: [' 1', '2 ', '3', ' 4 '],
      solution: { text: 'Add  the terms,\nthen simplify.', checked: true },
    });
    expect(gradingFp(edited)).toBe(gradingFp(base));
    expect(fingerprint(edited)).toBe(fingerprint(base));
  });
  it('a solution edit changes fingerprint but not gradingFp', () => {
    const e = with_({ solution: { text: 'A different worked solution.', checked: true } });
    expect(gradingFp(e)).toBe(gradingFp(base));
    expect(fingerprint(e)).not.toBe(fingerprint(base));
  });
  it.each<[string, Partial<Item>]>([
    ['key', { key: 2 }],
    ['stem', { stem: 'Evaluate something else.' }],
    ['option text', { options: ['1', '2', '3', '5'] }],
    ['marks', { marks: 2 }],
    ['nat_range', { nat_range: [1, 2] }],
  ])('a %s edit changes both hashes', (_n, over) => {
    expect(gradingFp(with_(over))).not.toBe(gradingFp(base));
    expect(fingerprint(with_(over))).not.toBe(fingerprint(base));
  });
  it('MSQ key order does not matter', () => {
    expect(gradingFp(with_({ type: 'MSQ', key: [2, 0] }))).toBe(gradingFp(with_({ type: 'MSQ', key: [0, 2] })));
  });
  it('spaces that separate words or commands survive normalisation', () => {
    expect(normaliseForFingerprint('\\alpha x')).toBe('\\alpha x');
    expect(normaliseForFingerprint('a  b')).toBe('a b');
    expect(normaliseForFingerprint('x + y')).toBe('x+y');
  });
  it('gradingFp and fingerprint are distinct 64-hex digests', () => {
    expect(gradingFp(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(base)).not.toBe(gradingFp(base));
  });
});

describe('ledger tag', () => {
  it('round-trips', () => {
    const tag = ledgerTag(base.id, fingerprint(base));
    expect(tag).toBe(`ledger:syn-001@${fp8(fingerprint(base))}`);
    expect(parseLedgerTag(tag)).toEqual({ id: 'syn-001', fp8: fp8(fingerprint(base)) });
  });
  it.each(['ledger:@abcd1234', 'ledger:x@XYZ', 'x@abcd1234', 'ledger:x@abcd123'])('rejects %s', (t) => {
    try { parseLedgerTag(t); expect.unreachable(); } catch (e) { expect(isBrainError(e, 'InvalidItemId')).toBe(true); }
  });
});

describe('isServable', () => {
  const fp = fingerprint(base);
  it('verified with no overlay is servable', () => expect(isServable(base, [])).toBe(true));
  it('retired is not servable', () => expect(isServable(with_({ status: 'retired' }), [])).toBe(false));
  it.each(['disputed', 'quarantined'] as const)('an open %s row at this fingerprint blocks it', (status) => {
    expect(isServable(base, [{ item_id: base.id, fingerprint: fp, status }])).toBe(false);
  });
  it('a closed row, another fingerprint or another item does not block', () => {
    expect(isServable(base, [{ item_id: base.id, fingerprint: fp, status: 'disputed', closed_at: '2026-11-25T00:00:00Z' }])).toBe(true);
    expect(isServable(base, [{ item_id: base.id, fingerprint: 'f'.repeat(64), status: 'disputed' }])).toBe(true);
    expect(isServable(base, [{ item_id: 'other', fingerprint: fp, status: 'disputed' }])).toBe(true);
  });
});
