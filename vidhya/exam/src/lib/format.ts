import type { CheckResult } from '../api/types';

/** DR12: a counted win line, never an estimate. Only for a correct answer. */
export function winLine(week: NonNullable<CheckResult['week']>): string {
  return `Right. That's ${week.right} of ${week.total} ${week.topicNoun} items this week.`;
}

/** h:mm:ss, tabular. Never negative. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** DR4 headline for the Today card, in both states. */
export function plannedHeadline(p: {
  estimate: { low: number; high: number; attempts: number } | null;
  gateWeightMarks: number;
}): { headline: string; basisTail: string } {
  if (p.estimate) {
    return {
      headline: `+${p.estimate.low}–${p.estimate.high} marks`,
      basisTail: `estimate from ${p.estimate.attempts} attempts`,
    };
  }
  return {
    headline: `Topics worth ${p.gateWeightMarks} marks in GATE`,
    basisTail: 'from GATE topic weights. Your marks estimate appears after the mock or 30 answers.',
  };
}

/** Signed marking chip, e.g. "+1 · −⅓". */
export function markingChip(marks: number, negative: string): string {
  return `+${marks} · ${negative}`;
}

export const KIND_LABEL = { mcq: 'MCQ', msq: 'MSQ', nat: 'numerical answer' } as const;
