import { describe, it, expect } from 'vitest';
import { aggregate, classify, type TaggedItem, type WrongAttempt } from '../taxonomy.js';

const mcqItem = (tags?: TaggedItem['distractor_tags']): TaggedItem => ({
  id: 'q', pool: 'practice', type: 'MCQ', answer_kind: 'options', marks: 1, topic_id: 'linalg', concept_id: 'c',
  stem: 's', options: ['a', 'b', 'c', 'd'], key: 0, solution: { text: 'x', checked: true }, status: 'verified', since_version: 'v0',
  ...(tags ? { distractor_tags: tags } : {}),
});
const natItem = (key: string, range: [number, number]): TaggedItem => ({
  id: 'n', pool: 'practice', type: 'NAT', answer_kind: 'number', marks: 1, topic_id: 'calculus', concept_id: 'c',
  stem: 's', key, nat_range: range, solution: { text: 'x', checked: true }, status: 'verified', since_version: 'v0',
});
const wrong = (over: Partial<WrongAttempt>): WrongAttempt => ({
  item_id: 'q', topic_id: 'linalg', item: mcqItem(), response: { kind: 'mcq', selectedIndex: 1 }, skipped_at_timeout: false,
  elapsed_ms: 60_000, reference_ms: 60_000, ...over,
});

describe('taxonomy bucket per fixture', () => {
  const tagged = mcqItem({ B: 'calc', C: 'concept' });
  const cases: [string, Partial<WrongAttempt>, string][] = [
    ['blank at time-out', { skipped_at_timeout: true, response: { kind: 'mcq', skipped: true } }, 'TIME'],
    ['TIME beats EXAMCRAFT', { skipped_at_timeout: true, response: { kind: 'mcq', skipped: true }, elapsed_ms: 1 }, 'TIME'],
    ['fast wrong answer is a guess', { item: tagged, elapsed_ms: 17_000 }, 'EXAMCRAFT'],
    ['EXAMCRAFT beats a calc tag', { item: tagged, elapsed_ms: 1000 }, 'EXAMCRAFT'],
    ['exactly 0.3 x median is not a guess', { item: tagged, elapsed_ms: 18_000 }, 'CALC'],
    ['calc distractor', { item: tagged, response: { kind: 'mcq', selectedIndex: 1 } }, 'CALC'],
    ['concept distractor', { item: tagged, response: { kind: 'mcq', selectedIndex: 2 } }, 'CONCEPT'],
    ['MSQ with a calc and a concept pick: CALC wins by order', { item: { ...tagged, type: 'MSQ', key: [0] }, response: { kind: 'msq', selectedIndices: [1, 2] } }, 'CALC'],
    ['no reference time: EXAMCRAFT cannot apply', { item: tagged, elapsed_ms: 1, reference_ms: null }, 'CALC'],
    ['NAT inside +-10% of key', { item: natItem('10', [9.9, 10.1]), response: { kind: 'nat', value: 10.9 } }, 'CALC'],
    ['NAT outside the near band', { item: natItem('10', [9.9, 10.1]), response: { kind: 'nat', value: 12 } }, 'CONCEPT'],
    ['NAT key 0: within 3 half-widths is near', { item: natItem('0', [-0.1, 0.1]), response: { kind: 'nat', value: 0.25 } }, 'CALC'],
    ['NAT key 0: beyond 3 half-widths is far', { item: natItem('0', [-0.1, 0.1]), response: { kind: 'nat', value: 0.31 } }, 'CONCEPT'],
  ];
  for (const [name, over, bucket] of cases) it(`${name} -> ${bucket}`, () => expect(classify(wrong(over))).toBe(bucket));
});

describe('UNCLASSIFIED when untagged', () => {
  it('an MCQ without distractor_tags is UNCLASSIFIED, never guessed', () => {
    expect(classify(wrong({ item: mcqItem() }))).toBe('UNCLASSIFIED');
  });
  it('a tagged item where the chosen option has no tag is UNCLASSIFIED', () => {
    expect(classify(wrong({ item: mcqItem({ C: 'concept' }), response: { kind: 'mcq', selectedIndex: 3 } }))).toBe('UNCLASSIFIED');
  });
  it('an item that left the pack is UNCLASSIFIED', () => {
    expect(classify(wrong({ item: undefined }))).toBe('UNCLASSIFIED');
  });
});

describe('aggregate', () => {
  it('counts per topic and reports honest coverage', () => {
    const t = mcqItem({ B: 'calc' });
    const r = aggregate([
      wrong({ item: t }), wrong({ item: t }), wrong({ item: mcqItem() }),
      wrong({ topic_id: 'calculus', item: natItem('10', [9.9, 10.1]), response: { kind: 'nat', value: 50 } }),
    ]);
    expect(r.wrong_total).toBe(4);
    expect(r.totals).toEqual({ TIME: 0, EXAMCRAFT: 0, CALC: 2, CONCEPT: 1, UNCLASSIFIED: 1 });
    expect(r.by_topic.linalg).toEqual({ TIME: 0, EXAMCRAFT: 0, CALC: 2, CONCEPT: 0, UNCLASSIFIED: 1 });
    expect(r.by_topic.calculus!.CONCEPT).toBe(1);
    expect(r.coverage).toBe(0.75);
  });
  it('no wrong answers: coverage is null, not 100%', () => {
    expect(aggregate([])).toMatchObject({ wrong_total: 0, coverage: null });
  });
});
