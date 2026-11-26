/**
 * Practice for /exam: serve an item (E12 records the SERVED time), check an answer, topics.
 * Only practice-pool items are served here; a mock item looks exactly like an unknown id.
 * Keys never leave before an attempt; `check` reveals the key after the answer is stored.
 */
import { randomUUID } from 'node:crypto';
import { BrainError } from '../errors.js';
import { fingerprint, isServable, type Item } from '../item/schema.js';
import { hiddenItemIdsFor, openOverlayRows } from '../disputes/disputes.js';
import { entitledAt, getStudent } from '../registry/registry.js';
import { acceptPracticeAnswer } from '../mock/practice.js';
import type { Answer, CheckOutcome, CheckRequest, CheckResult, ExamItem, TodayItemRef, TopicRow } from '../../../shared/api-contract.js';
import { answerToResponse, formatKey, formatNegative, formatYours, gradeItem, marksOf, optionKey, verificationOf } from './grade.js';
import { renderable, renderedOf, requireFlag, type Deps } from './deps.js';

export function topicLabel(d: Deps, topicId: string): string {
  return d.pack.topics.find((t) => t.id === topicId)?.label ?? topicId;
}

/** A practice-pool item this student may be served right now; anything else is ItemNotFound (no probing). */
export function servablePractice(d: Deps, student: string, id: string): Item {
  const item = d.pack.byId.get(id);
  if (!item || item.pool !== 'practice' || !isServable(item, openOverlayRows(d.db)) || hiddenItemIdsFor(d.db, student).has(id)) {
    throw new BrainError('ItemNotFound', 'no such question');
  }
  return item;
}

export function toExamItem(d: Deps, item: Item): ExamItem {
  const html = renderedOf(d, item); // throws RenderFailed / RenderMissing: an unrenderable item is not served
  const out: ExamItem = {
    id: item.id,
    topic: item.topic_id,
    topicLabel: topicLabel(d, item.topic_id),
    kind: item.type.toLowerCase() as ExamItem['kind'],
    marks: marksOf(item),
    negative: formatNegative(item, d.pack.marking),
    stemHtml: html.stem,
    fingerprint: fingerprint(item),
    verification: verificationOf(item),
  };
  if (item.options) out.options = item.options.map((o, i) => ({ key: optionKey(i), html: html.options[i]! }));
  return out;
}

export function serveItem(d: Deps, student: string, id: string, now: Date): ExamItem {
  // E12: entitlement is judged when the item is SERVED. NAT needs its flag.
  const probe = servablePractice(d, student, id);
  requireFlag(d, student, now, probe.type === 'NAT' ? 'nat' : 'exam_page');
  const out = toExamItem(d, probe); // render first: an unrenderable item must not be recorded as served
  d.db.prepare('INSERT INTO practice_serves (student_hash, item_id, fingerprint, served_at) VALUES (?, ?, ?, ?)').run(
    student, id, fingerprint(probe), now.toISOString(),
  );
  return out;
}

function weekCounts(d: Deps, student: string, topicId: string, now: Date): { right: number; total: number } {
  const ids = d.pack.items.filter((i) => i.topic_id === topicId).map((i) => i.id);
  if (ids.length === 0) return { right: 0, total: 0 };
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const row = d.db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS right FROM attempts
       WHERE student_hash = ? AND context = 'practice' AND ts >= ? AND item_id IN (${ids.map(() => '?').join(',')})`,
    )
    .get(student, since, ...ids) as { total: number; right: number };
  return row;
}

export function checkPractice(d: Deps, student: string, id: string, req: CheckRequest, now: Date): CheckOutcome {
  const item = servablePractice(d, student, id);
  const response = answerToResponse(item, req?.answer);
  const served = d.db
    .prepare('SELECT served_at FROM practice_serves WHERE student_hash = ? AND item_id = ? ORDER BY served_at DESC, id DESC LIMIT 1')
    .get(student, id) as { served_at: string } | undefined;
  if (!served) throw new BrainError('ItemNotServed', 'open the question before answering it');
  // E12: judged by served time, however late the answer arrives.
  const decision = acceptPracticeAnswer(d.db, student, id, new Date(served.served_at), now);
  if (!decision.counts) throw new BrainError('AccessEnded', 'this question was opened after access ended');

  const g = gradeItem(item, response, d.pack.marking);
  const reasonHtml = renderedOf(d, item).solution; // before any write
  const key = `${student}:${id}:${req.idempotencyKey ?? randomUUID()}`;
  if (req.elapsedMs !== undefined && (!Number.isInteger(req.elapsedMs) || req.elapsedMs < 0)) throw new BrainError('BadRequest', 'elapsedMs must be a whole number >= 0');
  d.db
    .prepare(
      `INSERT INTO attempts (idempotency_key, student_hash, item_id, fingerprint, pack_version, context, response_json, correct, skipped,
         marks_awarded, marks_max, elapsed_ms, source, ts)
       VALUES (?, ?, ?, ?, ?, 'practice', ?, ?, 0, ?, ?, ?, 'brain', ?) ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .run(key, student, id, fingerprint(item), d.pack.version, JSON.stringify(response), g.correct ? 1 : 0, g.marks_awarded, g.max, req.elapsedMs ?? null, now.toISOString());
  const wk = weekCounts(d, student, item.topic_id, now);
  const result: CheckResult = {
    itemId: id,
    outcome: g.correct ? 'correct' : 'wrong',
    yours: formatYours(req.answer),
    key: formatKey(item),
    reason: item.solution.text,
    reasonHtml,
    scored: g.marks_awarded,
    week: g.correct ? { right: wk.right, total: wk.total, topicNoun: topicLabel(d, item.topic_id).toLowerCase() } : null,
    verification: verificationOf(item),
  };
  return { status: 'checked', result };
}

export function listTopics(d: Deps, student: string): TopicRow[] {
  const overlay = openOverlayRows(d.db);
  const hidden = hiddenItemIdsFor(d.db, student);
  return d.pack.topics.map((t) => ({
    id: t.id,
    label: t.label,
    natCount: d.pack.items.filter((i) => i.pool === 'practice' && i.type === 'NAT' && i.topic_id === t.id && isServable(i, overlay) && renderable(d, i) && !hidden.has(i.id)).length,
  }));
}

export function topicItems(d: Deps, student: string, topicId: string): TodayItemRef[] {
  const overlay = openOverlayRows(d.db);
  const hidden = hiddenItemIdsFor(d.db, student);
  return d.pack.items
    .filter((i) => i.pool === 'practice' && i.topic_id === topicId && isServable(i, overlay) && renderable(d, i) && !hidden.has(i.id))
    .map((i) => ({ id: i.id, topicLabel: topicLabel(d, i.topic_id), kind: i.type.toLowerCase() as TodayItemRef['kind'] }));
}

export function entitled(d: Deps, student: string, now: Date): boolean {
  return entitledAt(getStudent(d.db, student), now);
}
export type { Answer };
