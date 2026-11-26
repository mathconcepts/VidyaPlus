/**
 * The marks view the HTTP layer calls: getMarks(db, student_hash, opts).
 *
 * Inputs it reads:
 *   - `attempts` rows of the student, excluding context 'mock' (mock answers live in mock_answers;
 *     a stray 'mock' row would double count).
 *   - the student's SCORED mock(s) (state 'scored', finished). Practice mocks (state practice_only,
 *     any later attempt) never enter the range, the score or the taxonomy.
 * Skipped practice rows are not attempts and are not samples. Skipped mock items are samples worth 0
 * (a blank paper is a real result), and a blank on a timed-out mock is a TIME mistake.
 * Taxonomy rows from a mock appear only after that form is closed (DR11: no key leak by topic).
 */
import { BrainError } from '../errors.js';
import type { StudentResponse } from '../scoring/scorer.js';
import { computeOutcomes } from '../mock/score.js';
import { getForm, type Db, type MockContext, type MockRow } from '../mock/rows.js';
import { LABEL_SCORED } from '../mock/view.js';
import { gatedRange, type MarksRange, type RangeNeedsMore, type RangeSample } from './range.js';
import { aggregate, type TaggedItem, type Taxonomy, type WrongAttempt } from './taxonomy.js';

export { bootstrapRange, gatedRange, MIN_ATTEMPTS_FOR_RANGE, RESAMPLES } from './range.js';
export { classify, aggregate, BUCKETS } from './taxonomy.js';

export interface MarksOptions {
  /** Marks of the exam section the range is stated in (from the pack's exam.yaml). */
  section_marks: number;
  /** Item lookup and marking; without it topics are 'unknown', mock items are not sampled and nothing is tagged. */
  ctx?: Pick<MockContext, 'resolveItem'> & Partial<MockContext>;
  /** Used for EXAMCRAFT until the item has a B7 median (n >= 5): milliseconds per mark. Unset disables the prior. */
  prior_ms_per_mark?: number;
  resamples?: number;
}

export interface MarksScore {
  score: number;
  max_marks: number;
  label: string;
}

export interface MarksView {
  score?: MarksScore;
  range: MarksRange | RangeNeedsMore;
  taxonomy: Taxonomy;
  mock_completed: boolean;
}

interface AttemptRow {
  item_id: string;
  fingerprint: string;
  response_json: string;
  correct: number;
  skipped: number;
  marks_awarded: number;
  marks_max: number;
  elapsed_ms: number | null;
}

const MIN_STATS_N = 5;

function referenceMs(db: Db, itemId: string, fp: string, marks: number, prior?: number): number | null {
  const s = db.prepare('SELECT n, median_ms FROM item_stats WHERE item_id = ? AND fingerprint = ?').get(itemId, fp) as { n: number; median_ms: number | null } | undefined;
  if (s && s.n >= MIN_STATS_N && s.median_ms) return s.median_ms;
  return prior && prior > 0 ? prior * marks : null;
}

export function getMarks(db: Db, student_hash: string, opts: MarksOptions): MarksView {
  if (!student_hash) throw new BrainError('InvalidMarksQuery', 'student is required');
  if (!(opts.section_marks > 0)) throw new BrainError('InvalidMarksQuery', 'section_marks must be positive');
  const resolve = opts.ctx?.resolveItem;

  const samples: RangeSample[] = [];
  const wrongs: WrongAttempt[] = [];
  let attempts = 0;

  const rows = db
    .prepare(`SELECT item_id, fingerprint, response_json, correct, skipped, marks_awarded, marks_max, elapsed_ms FROM attempts WHERE student_hash = ? AND context != 'mock' ORDER BY id`)
    .all(student_hash) as AttemptRow[];
  for (const r of rows) {
    if (r.skipped) continue;
    attempts++;
    samples.push({ awarded: r.marks_awarded, max: r.marks_max });
    if (!r.correct) {
      const item = resolve?.(r.item_id) as TaggedItem | undefined;
      wrongs.push({
        item_id: r.item_id,
        topic_id: item?.topic_id ?? 'unknown',
        item,
        response: JSON.parse(r.response_json) as StudentResponse,
        skipped_at_timeout: false,
        elapsed_ms: r.elapsed_ms,
        reference_ms: referenceMs(db, r.item_id, r.fingerprint, r.marks_max, opts.prior_ms_per_mark),
      });
    }
  }

  const mocks = db
    .prepare(`SELECT * FROM mocks WHERE student_hash = ? AND state = 'scored' AND submitted_at IS NOT NULL ORDER BY id`)
    .all(student_hash) as MockRow[];
  let score: MarksScore | undefined;
  for (const m of mocks) {
    const t = m.result_json ? (JSON.parse(m.result_json) as { score: number; max_marks: number }) : undefined;
    if (t) score = { score: t.score, max_marks: t.max_marks, label: LABEL_SCORED };
    if (!opts.ctx?.marking) continue;
    const ctx = opts.ctx as MockContext;
    const outcomes = computeOutcomes(db, ctx, m);
    const closed = getForm(db, m.form_version).closed_at !== null;
    const timedOut = m.submit_reason === 'auto';
    for (const o of outcomes) {
      if (o.state !== 'counted') continue;
      attempts++;
      samples.push({ awarded: o.awarded, max: o.max });
      if (o.correct || !closed) continue;
      const item = ctx.resolveItem(o.item_id) as TaggedItem | undefined;
      wrongs.push({
        item_id: o.item_id,
        topic_id: item?.topic_id ?? 'unknown',
        item,
        response: o.response,
        skipped_at_timeout: o.skipped && timedOut,
        elapsed_ms: null,
        reference_ms: null,
      });
    }
  }
  // A skipped mock item on a paper submitted by the student is a blank, not a mistake we can name: leave it out.
  const taxonomyRows = wrongs.filter((w) => !(w.response === null || w.response.skipped) || w.skipped_at_timeout);

  const mock_completed = mocks.length > 0;
  const range = gatedRange({
    samples,
    attempts,
    mock_completed,
    section_marks: opts.section_marks,
    seed: student_hash,
    resamples: opts.resamples,
  });
  return { ...(score ? { score } : {}), range, taxonomy: aggregate(taxonomyRows), mock_completed };
}
