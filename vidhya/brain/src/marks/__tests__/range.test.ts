import { describe, it, expect } from 'vitest';
import { type Db } from '../../store/db.js';
import { bootstrapRange, gatedRange, mulberry32, MIN_ATTEMPTS_FOR_RANGE, RESAMPLES, type RangeSample } from '../range.js';
import { getMarks } from '../index.js';
import { startAttempt, saveAnswer, submit } from '../../mock/attempts.js';
import { closeMock } from '../../mock/close.js';
import { world, T0, min, at, meta, mcq, S1, S2, ITEMS, FORM_MINUTES, type World } from '../../mock/__tests__/fixtures.js';

const mix = (n: number, rightEvery = 2): RangeSample[] => Array.from({ length: n }, (_, i) => ({ awarded: i % rightEvery === 0 ? 1 : 0, max: 1 }));
const SECTION = 13;

function addAttempt(db: Db, student: string, i: number, over: Record<string, unknown> = {}) {
  const row = {
    idempotency_key: `${student}-${i}-${JSON.stringify(over).length}`, student_hash: student, item_id: 'm1', fingerprint: 'fp', pack_version: 'v0',
    context: 'practice', response_json: JSON.stringify({ kind: 'mcq', selectedIndex: 1 }), correct: i % 2 === 0 ? 1 : 0, skipped: 0,
    marks_awarded: i % 2 === 0 ? 1 : 0, marks_max: 1, elapsed_ms: 40_000, source: 'brain', ts: '2026-12-01T00:00:00Z', ...over,
  };
  db.prepare(`INSERT INTO attempts (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => '@' + k).join(',')})`).run(row);
}
const addMany = (db: Db, student: string, n: number, over: Record<string, unknown> = {}) => {
  for (let i = 0; i < n; i++) addAttempt(db, student, i, over);
};

describe('bootstrapRange', () => {
  it('is deterministic for the same attempts and seed, and the seed matters', () => {
    const s = mix(40);
    const a = bootstrapRange(s, SECTION, { seed: 'student-a' });
    expect(bootstrapRange(s, SECTION, { seed: 'student-a' })).toEqual(a);
    const small = mix(7, 3);
    const c = bootstrapRange(small, SECTION, { seed: 'student-b', resamples: 9 });
    const d = bootstrapRange(small, SECTION, { seed: 'student-a', resamples: 9 });
    expect([c.low, c.high]).not.toEqual([d.low, d.high]);
  });
  it('PRNG is the fixed mulberry32 sequence (golden)', () => {
    const r = mulberry32(12345);
    expect([r(), r(), r()].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.979728, 0.306752, 0.484205]);
  });
  it('is an 80% interval around the estimate, inside [0, section marks], labelled with N', () => {
    const r = bootstrapRange(mix(60), SECTION, { seed: 's' });
    expect(r.estimate).toBeCloseTo(6.5, 1);
    expect(r.low).toBeLessThan(r.estimate);
    expect(r.high).toBeGreaterThan(r.estimate);
    expect(r.low).toBeGreaterThanOrEqual(0);
    expect(r.high).toBeLessThanOrEqual(SECTION);
    expect(r.level).toBe(0.8);
    expect(r.label).toBe('estimate from 60 attempts');
    expect(r.low_n).toBe(false);
  });
  it('more attempts narrow the interval', () => {
    const w = (n: number) => { const r = bootstrapRange(mix(n), SECTION, { seed: 's' }); return r.high - r.low; };
    expect(w(300)).toBeLessThan(w(30));
  });
  it('small N: still a range, flagged low_n, with a wide span; n = 1 collapses to a point', () => {
    const r = bootstrapRange(mix(4), SECTION, { seed: 's' });
    expect(r.low_n).toBe(true);
    expect(r.high - r.low).toBeGreaterThan(3);
    const one = bootstrapRange([{ awarded: 1, max: 1 }], SECTION, { seed: 's' });
    expect(one).toMatchObject({ low: SECTION, estimate: SECTION, high: SECTION, low_n: true });
  });
  it('negative marking never pushes the range below 0', () => {
    const r = bootstrapRange([{ awarded: -1 / 3, max: 1 }, { awarded: -2 / 3, max: 2 }], SECTION, { seed: 's' });
    expect(r.low).toBe(0);
    expect(r.estimate).toBe(0);
  });
  it('refuses no samples and a bad section size', () => {
    expect(() => bootstrapRange([], SECTION, { seed: 's' })).toThrow(/InvalidMarksQuery/);
    expect(() => bootstrapRange(mix(5), 0, { seed: 's' })).toThrow(/InvalidMarksQuery/);
  });
  it('uses the fixed resample count by default', () => {
    expect(RESAMPLES).toBe(2000);
  });
});

describe('gatedRange: O5-5', () => {
  const g = (attempts: number, mock_completed = false) => gatedRange({ samples: mix(attempts || 1), attempts, mock_completed, section_marks: SECTION, seed: 's' });
  it('29 attempts: needs more, with the instruction text', () => {
    expect(g(29)).toEqual({ status: 'needs_more', attempts: 29, message: 'Take the mock to see your marks range.' });
  });
  it('30 attempts: the range shows', () => {
    expect(MIN_ATTEMPTS_FOR_RANGE).toBe(30);
    expect(g(30)).toMatchObject({ status: 'ok', n: 30, label: 'estimate from 30 attempts' });
  });
  it('a completed mock opens the gate below 30', () => {
    expect(g(12, true)).toMatchObject({ status: 'ok', n: 12 });
  });
  it('a completed mock with nothing to resample still says needs_more', () => {
    expect(gatedRange({ samples: [], attempts: 0, mock_completed: true, section_marks: SECTION, seed: 's' })).toMatchObject({ status: 'needs_more' });
  });
});

describe('getMarks', () => {
  it('29 practice attempts then 30 (gate through the store); skipped rows are not attempts', () => {
    const { db } = world();
    addMany(db, S1, 29);
    addAttempt(db, S1, 99, { skipped: 1, correct: 0, marks_awarded: 0, idempotency_key: 'skip' });
    const before = getMarks(db, S1, { section_marks: SECTION });
    expect(before.range).toMatchObject({ status: 'needs_more', attempts: 29 });
    expect(before.score).toBeUndefined();
    addAttempt(db, S1, 100, { idempotency_key: 'thirtieth' });
    const after = getMarks(db, S1, { section_marks: SECTION });
    expect(after.range).toMatchObject({ status: 'ok', n: 30, label: 'estimate from 30 attempts' });
  });
  it('other students attempts never count', () => {
    const { db } = world();
    addMany(db, S2, 40);
    expect(getMarks(db, S1, { section_marks: SECTION }).range).toMatchObject({ status: 'needs_more', attempts: 0 });
  });
  it('is stable across calls (cacheable, deterministic)', () => {
    const { db } = world();
    addMany(db, S1, 35);
    expect(getMarks(db, S1, { section_marks: SECTION })).toEqual(getMarks(db, S1, { section_marks: SECTION }));
  });

  describe('mock completion gate and practice exclusion', () => {
    function finishedMock(w: World, student: string, answers: [string, number][]) {
      const a = startAttempt(w.db, w.ctx, student, 'f1', T0);
      for (const [id, i] of answers) saveAnswer(w.db, w.ctx, student, a.attempt_id, id, mcq(i), meta(student, at(T0, min(1))));
      submit(w.db, w.ctx, student, a.attempt_id, at(T0, min(2)));
      return a;
    }
    it('an unfinished mock does not open the gate', () => {
      const w = world();
      startAttempt(w.db, w.ctx, S1, 'f1', T0);
      const v = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx });
      expect(v.mock_completed).toBe(false);
      expect(v.range.status).toBe('needs_more');
    });
    it('a submitted scored mock opens the range below 30 attempts and reports the labelled score', () => {
      const w = world();
      finishedMock(w, S1, [['m1', 1], ['m2', 0]]);
      const v = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx });
      expect(v.mock_completed).toBe(true);
      expect(v.range).toMatchObject({ status: 'ok', n: 4, low_n: true });
      expect(v.score).toMatchObject({ max_marks: 6, label: 'unproctored practice mock' });
    });
    it('a second (practice) mock attempt is excluded from the range, score and taxonomy', () => {
      const w = world();
      finishedMock(w, S1, [['m1', 1], ['m2', 2]]); // m1 right, m2 right
      const first = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx });
      const practice = startAttempt(w.db, w.ctx, S1, 'f1', at(T0, min(30)));
      saveAnswer(w.db, w.ctx, S1, practice.attempt_id, 'm1', mcq(3), meta(S1, at(T0, min(31))));
      submit(w.db, w.ctx, S1, practice.attempt_id, at(T0, min(32)));
      expect(w.db.prepare("SELECT COUNT(*) n FROM mocks WHERE state = 'practice_only'").get()).toEqual({ n: 1 });
      expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx })).toEqual(first);
    });
    it('a stray attempts row with context mock is not double counted', () => {
      const w = world();
      finishedMock(w, S1, [['m1', 1]]);
      addMany(w.db, S1, 3, { context: 'mock' });
      expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx }).range).toMatchObject({ n: 4 });
    });
    it('mock taxonomy stays hidden until the form closes; a blank on a timed-out paper is TIME', () => {
      const w = world();
      const tagged = { ...ITEMS[0]!, distractor_tags: { A: 'concept' as const } };
      w.items.set('m1', tagged); // m1 key is 1; picking option 0 = A = concept
      const a = startAttempt(w.db, w.ctx, S1, 'f1', T0);
      saveAnswer(w.db, w.ctx, S1, a.attempt_id, 'm1', mcq(0), meta(S1, at(T0, min(1))));
      // never submitted: the paper times out and everything else is blank
      const deadline = at(T0, min(FORM_MINUTES));
      const pre = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx }); // not settled yet
      expect(pre.mock_completed).toBe(false);
      closeMock(w.db, w.ctx, 'f1', 'admin', at(deadline, 120_000));
      const post = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx });
      expect(post.taxonomy.totals).toMatchObject({ CONCEPT: 1, TIME: 3, UNCLASSIFIED: 0 });
      expect(post.taxonomy.by_topic['topic-secret']).toMatchObject({ CONCEPT: 1, TIME: 3 });
    });
    it('before close no mock mistakes appear in the taxonomy', () => {
      const w = world();
      finishedMock(w, S1, [['m1', 0], ['m2', 0]]);
      const v = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx });
      expect(v.taxonomy.wrong_total).toBe(0);
    });
  });

  it('practice taxonomy: wrong attempts classified via the item tags, untagged shown as UNCLASSIFIED', () => {
    const w = world();
    w.items.set('m1', { ...ITEMS[0]!, pool: 'practice', distractor_tags: { C: 'calc' } } as never);
    addAttempt(w.db, S1, 1, { item_id: 'm1', response_json: JSON.stringify({ kind: 'mcq', selectedIndex: 2 }), idempotency_key: 'a' });
    addAttempt(w.db, S1, 3, { item_id: 'm2', idempotency_key: 'b' });
    const v = getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx });
    expect(v.taxonomy.totals).toMatchObject({ CALC: 1, UNCLASSIFIED: 1 });
    expect(v.taxonomy.coverage).toBe(0.5);
  });
  it('a fast wrong practice answer is EXAMCRAFT against the item median once n >= 5, else the prior', () => {
    const w = world();
    addAttempt(w.db, S1, 1, { item_id: 'm1', elapsed_ms: 5_000, fingerprint: 'fpx', idempotency_key: 'a' });
    expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx }).taxonomy.totals.EXAMCRAFT).toBe(0); // no reference
    expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx, prior_ms_per_mark: 60_000 }).taxonomy.totals.EXAMCRAFT).toBe(1);
    w.db.prepare("INSERT INTO item_stats (item_id, fingerprint, n, median_ms, computed_at) VALUES ('m1','fpx',2,1000,'t')").run();
    expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx, prior_ms_per_mark: 60_000 }).taxonomy.totals.EXAMCRAFT).toBe(1); // n<5 ignored
    w.db.prepare("UPDATE item_stats SET n = 9, median_ms = 10000").run();
    expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx }).taxonomy.totals.EXAMCRAFT).toBe(0); // 5000 > 0.3*10000
    w.db.prepare("UPDATE item_stats SET median_ms = 60000").run();
    expect(getMarks(w.db, S1, { section_marks: SECTION, ctx: w.ctx }).taxonomy.totals.EXAMCRAFT).toBe(1);
  });
  it('rejects a bad query', () => {
    const { db } = world();
    expect(() => getMarks(db, '', { section_marks: SECTION })).toThrow(/InvalidMarksQuery/);
    expect(() => getMarks(db, S1, { section_marks: 0 })).toThrow(/InvalidMarksQuery/);
  });
});
