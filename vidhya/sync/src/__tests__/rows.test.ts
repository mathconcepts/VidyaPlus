import { describe, expect, it } from 'vitest';
import { fingerprint, ledgerTag } from '../../../brain/src/item/schema.js';
import { itemToRow, itemsToRows, stemWithId } from '../rows.js';
import { mcq, msq } from './fixtures.js';

describe('itemToRow', () => {
  it('maps an MCQ to single_choice with letter options, a letter key and the ledger tag', () => {
    const item = mcq('syn-001');
    const row = itemToRow(item);
    expect(row.question_type).toBe('single_choice');
    expect(row.options).toEqual({ A: '3', B: '4', C: '5', D: '6' });
    expect(row.correct_answer).toBe('B');
    expect(row.tag).toBe(ledgerTag('syn-001', fingerprint(item)));
    expect(row.question).toBe('What is 2+2?\n\n[#syn-001]');
    expect(row.explanation).toBe('2+2 = 4');
    expect(row.tags).toEqual(['synthetic-topic', 'synthetic-concept']);
  });

  it('maps an MSQ to multi_choice with a sorted comma key', () => {
    const row = itemToRow(msq('syn-002', { key: [2, 0] }));
    expect(row.question_type).toBe('multi_choice');
    expect(row.correct_answer).toBe('A,C');
  });

  it('the tag changes when the key changes and when only the solution changes', () => {
    const a = itemToRow(mcq('syn-001')).tag;
    expect(itemToRow(mcq('syn-001', { key: 2 })).tag).not.toBe(a);
    expect(itemToRow(mcq('syn-001', { solution: { text: 'another route', checked: true } })).tag).not.toBe(a);
    expect(itemToRow(mcq('syn-001')).tag).toBe(a);
  });

  it('does not double the ledger id suffix', () => {
    expect(stemWithId('Q [#syn-001]', 'syn-001')).toBe('Q [#syn-001]');
  });

  it.each([
    ['NAT item', { type: 'NAT' as const }],
    ['mock-pool item', { pool: 'mock' as const }],
    ['key out of range', { key: 9 }],
    ['MCQ with an array key', { key: [0, 1] }],
    ['one option', { options: ['only'] }],
  ])('refuses %s', (_n, over) => {
    expect(() => itemToRow(mcq('syn-x', over))).toThrow(/InvalidItem/);
  });

  it('refuses an MSQ with fewer than 2 keys', () => {
    expect(() => itemToRow(msq('syn-x', { key: [1] }))).toThrow(/InvalidItem/);
  });

  it('refuses duplicate ids and sorts by id', () => {
    expect(() => itemsToRows([mcq('a'), mcq('a')])).toThrow(/duplicate/);
    expect(itemsToRows([mcq('b'), mcq('a')]).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
