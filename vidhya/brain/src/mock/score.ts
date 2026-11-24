/**
 * Mock scoring (S4 Schedule C). `computeOutcomes` is the one place a mock is scored. It reuses the scorer,
 * `isServable` and `gradingFp`; it adds no marking rule of its own. It is a pure
 * function of (stored answers, current items, open overlay), so an item Giri
 * voids after close drops out of everyone's score the next time a result is read.
 */
import { gradingFp, isServable, type Item } from '../item/schema.js';
import { openOverlayRows } from '../disputes/disputes.js';
import { scoreAttempt, type StudentResponse } from '../scoring/scorer.js';
import { toScorable } from './items.js';
import { frozenItems, type Db, type MockContext, type MockRow } from './rows.js';

export interface ItemOutcome {
  item_id: string;
  state: 'counted' | 'withdrawn';
  withdrawn_reason?: 'not_servable' | 'superseded' | 'missing';
  max: number;
  awarded: number;
  correct: boolean;
  skipped: boolean;
  response: StudentResponse | null;
}

export interface Totals {
  score: number;
  max_marks: number;
  right: number;
  wrong: number;
  skipped: number;
  withdrawn: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The effective answer per item: the latest client_entered_at wins (append-only log). */
export function effectiveResponses(db: Db, mockId: number): Map<string, StudentResponse> {
  const rows = db
    .prepare('SELECT item_id, response_json FROM mock_answers WHERE mock_id = ? ORDER BY client_entered_at, id')
    .all(mockId) as { item_id: string; response_json: string }[];
  const m = new Map<string, StudentResponse>();
  for (const r of rows) m.set(r.item_id, JSON.parse(r.response_json) as StudentResponse);
  return m;
}

export function computeOutcomes(db: Db, ctx: MockContext, row: MockRow): ItemOutcome[] {
  const overlay = openOverlayRows(db);
  const answers = effectiveResponses(db, row.id);
  return frozenItems(row).map((f): ItemOutcome => {
    const item: Item | undefined = ctx.resolveItem(f.item_id);
    const withdrawn = (reason: NonNullable<ItemOutcome['withdrawn_reason']>): ItemOutcome => ({
      item_id: f.item_id, state: 'withdrawn', withdrawn_reason: reason, max: 0, awarded: 0, correct: false, skipped: false,
      response: answers.get(f.item_id) ?? null,
    });
    if (!item) return withdrawn('missing');
    if (!isServable(item, overlay)) return withdrawn('not_servable'); // S4 Schedule C
    if (gradingFp(item) !== f.grading_fp) return withdrawn('superseded'); // errata changed the grading
    const response = answers.get(f.item_id) ?? null;
    const scorable = toScorable(item);
    const g = scoreAttempt(scorable, response ?? { kind: scorable.kind, skipped: true }, ctx.marking);
    return { item_id: f.item_id, state: 'counted', max: g.max, awarded: g.marks_awarded, correct: g.correct, skipped: g.skipped, response };
  });
}

export function totals(outcomes: readonly ItemOutcome[]): Totals {
  const counted = outcomes.filter((o) => o.state === 'counted');
  return {
    score: round6(counted.reduce((a, o) => a + o.awarded, 0)),
    max_marks: round6(counted.reduce((a, o) => a + o.max, 0)),
    right: counted.filter((o) => o.correct).length,
    wrong: counted.filter((o) => !o.correct && !o.skipped).length,
    skipped: counted.filter((o) => o.skipped).length,
    withdrawn: outcomes.length - counted.length,
  };
}
