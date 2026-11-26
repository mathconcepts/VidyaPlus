/**
 * Today card and Marks tab.
 *
 * STARTER PLANNER. The full B4 planner (expected-gain scoring over mastery) is not built yet. This one
 * is deterministic and honest: topics the student has done least first, no item seen in the last 48 h,
 * nothing disputed or hidden, at least one NAT when the `nat` flag is on, packed greedily to the minute
 * budget at 1.5 minutes per mark. It never shows a marks estimate; `estimate` stays null until B5's
 * range exists, and the marks tab says so.
 */
import { isServable } from '../item/schema.js';
import { hiddenItemIdsFor, openOverlayRows } from '../disputes/disputes.js';
import type { MarksView, TaxonomyRow, TodayPlan } from '../../../shared/api-contract.js';
import { BUCKETS, getMarks as computeMarks } from '../marks/index.js';
import { flagsOf, renderable, requireFlag, type Deps } from './deps.js';
import { topicLabel } from './practice.js';
import { fmtDay, mockLine } from './mock.js';

const MIN_PER_MARK = 1.5;
const RECENT_MS = 48 * 3_600_000;

export function getToday(d: Deps, student: string, now: Date, minutes = 30): TodayPlan {
  requireFlag(d, student, now, 'today_card');
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) minutes = 30;
  const flags = flagsOf(d, student, now);
  const overlay = openOverlayRows(d.db);
  const hidden = hiddenItemIdsFor(d.db, student);
  const recent = new Set(
    (d.db.prepare("SELECT DISTINCT item_id FROM attempts WHERE student_hash = ? AND context = 'practice' AND ts >= ?").all(student, new Date(now.getTime() - RECENT_MS).toISOString()) as { item_id: string }[]).map((r) => r.item_id),
  );
  const doneByTopic = new Map<string, number>();
  for (const r of d.db.prepare("SELECT item_id, COUNT(*) AS n FROM attempts WHERE student_hash = ? AND context = 'practice' GROUP BY item_id").all(student) as { item_id: string; n: number }[]) {
    const t = d.pack.byId.get(r.item_id)?.topic_id;
    if (t) doneByTopic.set(t, (doneByTopic.get(t) ?? 0) + r.n);
  }
  const pool = d.pack.items
    .filter((i) => i.pool === 'practice' && isServable(i, overlay) && renderable(d, i) && !hidden.has(i.id) && !recent.has(i.id) && (i.type !== 'NAT' || flags.nat))
    .sort((a, b) => (doneByTopic.get(a.topic_id) ?? 0) - (doneByTopic.get(b.topic_id) ?? 0) || a.id.localeCompare(b.id));

  const chosen: typeof pool = [];
  let left = minutes;
  const take = (i: (typeof pool)[number]) => {
    chosen.push(i);
    left -= i.marks * MIN_PER_MARK;
  };
  const nat = pool.find((i) => i.type === 'NAT');
  if (nat && nat.marks * MIN_PER_MARK <= left) take(nat);
  for (const i of pool) if (!chosen.includes(i) && i.marks * MIN_PER_MARK <= left) take(i);

  const topicIds = [...new Set(chosen.map((i) => i.topic_id))];
  const attempted = (d.db.prepare("SELECT DISTINCT item_id FROM attempts WHERE student_hash = ? AND context = 'practice'").all(student) as { item_id: string }[]).map((r) => r.item_id);
  return {
    minutes,
    items: chosen.map((i) => ({ id: i.id, topicLabel: topicLabel(d, i.topic_id), kind: i.type.toLowerCase() as 'mcq' | 'msq' | 'nat' })),
    topics: topicIds.map((t) => topicLabel(d, t)),
    gateWeightMarks: topicIds.reduce((a, t) => a + (d.pack.topics.find((x) => x.id === t)?.weight_marks ?? 0), 0),
    estimate: null,
    mockLine: mockLine(d, now),
    continueRow: null,
    withdrawnCount: attempted.filter((id) => { const it = d.pack.byId.get(id); return !it || !isServable(it, overlay); }).length,
    cleared: chosen.length === 0,
  };
}

const BUCKET_LABEL: Record<TaxonomyRow['bucket'], string> = {
  TIME: 'Ran out of time',
  EXAMCRAFT: 'Answered too fast (a guess)',
  CALC: 'Arithmetic slip',
  CONCEPT: 'Concept gap',
  UNCLASSIFIED: 'Unclassified',
};
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Marks tab: the B5 range and mistake taxonomy, mapped to the contract. `section_marks` comes from the
 * pack. The range is the bootstrap's 80% interval, or "needs more" with its fixed sentence. UNCLASSIFIED
 * is a row like any other: it is never hidden or guessed into a bucket.
 */
export function getMarks(d: Deps, student: string, now: Date): MarksView {
  void now;
  const section = d.pack.section_marks;
  if (section === null) {
    return { range: null, basis: 'This exam has no section marks set, so no marks range can be shown.', lastWeek: null, lost: [], status: 'needs_more' };
  }
  const v = computeMarks(d.db, student, { section_marks: section, ctx: d.mockCtx });
  const taxonomy: TaxonomyRow[] = (BUCKETS.map((b) => ({ bucket: b, label: BUCKET_LABEL[b], wrong: v.taxonomy.totals[b] })) as TaxonomyRow[]).filter((r) => r.wrong > 0);
  const out: MarksView = { range: null, basis: '', lastWeek: null, lost: [], taxonomy, wrongTotal: v.taxonomy.wrong_total };
  if (v.score) out.score = { score: v.score.score, outOf: v.score.max_marks, label: v.score.label };
  if (v.range.status === 'ok') {
    out.status = 'ok';
    out.range = { low: round1(v.range.low), high: round1(v.range.high), of: v.range.section_marks };
    out.basis = v.range.label;
    out.lowN = v.range.low_n;
    out.attempts = v.range.n;
  } else {
    out.status = 'needs_more';
    out.basis = v.range.message;
    out.attempts = v.range.attempts;
  }
  return out;
}
export { fmtDay };
