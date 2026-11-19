const test = require('node:test');
const assert = require('node:assert');
const S = require('../site/scoring.js');
const pack = require('../site/data/diagnostic.json');

const items = [
  { topic: 'A', marks: 1, answer: 'A' }, { topic: 'A', marks: 2, answer: 'B' },
  { topic: 'B', marks: 1, answer: 'C' }, { topic: 'B', marks: 2, answer: 'D' },
];

test('GATE marking: +marks right, -marks/3 wrong, 0 skipped', () => {
  const r = S.scoreAttempt(items, ['A', 'A', null, 'D']);
  assert.strictEqual(r.right, 2); assert.strictEqual(r.wrong, 1); assert.strictEqual(r.skipped, 1);
  assert.ok(Math.abs(r.marks - (1 + 2 - 2 / 3)) < 0.01, 'marks ' + r.marks);
  assert.strictEqual(r.total, 6);
});

test('all wrong goes negative but the section estimate floors at 0', () => {
  const r = S.scoreAttempt(items, ['B', 'A', 'A', 'A']);
  assert.ok(r.marks < 0);
  assert.strictEqual(S.estimateSection(r, 13), 0);
});

test('perfect score estimates the full section', () => {
  const r = S.scoreAttempt(items, ['A', 'B', 'C', 'D']);
  assert.strictEqual(S.estimateSection(r, 13), 13);
});

test('weak topics are the ones under 50%, worst first', () => {
  const r = S.scoreAttempt(items, ['A', 'B', 'A', null]);
  assert.deepStrictEqual(S.weakTopics(r), ['B']);
});

test('when nothing is under 50%, the single worst topic is still named', () => {
  const r = S.scoreAttempt(items, ['A', 'B', 'C', 'D']);
  assert.strictEqual(S.weakTopics(r).length, 1);
});

test('14-day plan has 14 days, weakest topic first, day 14 is a timed mixed set', () => {
  const r = S.scoreAttempt(pack.items, pack.items.map(() => null));
  const plan = S.fourteenDayPlan(r);
  assert.strictEqual(plan.length, 14);
  assert.deepStrictEqual(plan.map(d => d.day), [...Array(14).keys()].map(i => i + 1));
  assert.strictEqual(plan[0].topic, S.weakTopics(r)[0]);
  assert.match(plan[13].task.toLowerCase(), /timed/);
});

test('shipped pack: 20 items, every item has exactly one SymPy-true option equal to its key', () => {
  assert.strictEqual(pack.items.length, 20);
  for (const it of pack.items) {
    assert.strictEqual(it.receipt.unique_true, true, it.id);
    assert.ok(it.options[it.answer], it.id + ' key not among options');
    assert.match(it.receipt.fingerprint, /^[0-9a-f]{12}$/);
  }
});

test('shipped pack: no chip claims review unless the pack says so', () => {
  for (const it of pack.items) {
    if (it.receipt.reviewed_by) assert.ok(it.receipt.reviewed_at, it.id + ' reviewed without a date');
  }
  if (pack.mode === 'release') assert.ok(pack.items.every(i => i.receipt.reviewed_by));
});
