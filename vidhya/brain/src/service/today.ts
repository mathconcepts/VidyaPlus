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
import type { MarksView, TodayPlan } from '../../../shared/api-contract.js';
import { flagsOf, requireFlag, type Deps } from './deps.js';
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
    .filter((i) => i.pool === 'practice' && isServable(i, overlay) && !hidden.has(i.id) && !recent.has(i.id) && (i.type !== 'NAT' || flags.nat))
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

/** Marks tab. The 80% range and the taxonomy (B5 analytics) are not built: the range is null with a plain reason. */
export function getMarks(d: Deps, student: string, now: Date): MarksView {
  void d; void student; void now;
  return {
    range: null,
    basis: 'Your marks range appears after you finish the mock or reach 30 practice attempts.',
    lastWeek: null,
    lost: [],
  };
}
export { fmtDay };
