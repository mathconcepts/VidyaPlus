import { describe, it, expect } from 'vitest';
import { formatClock, markingChip, plannedHeadline, winLine } from './format';

describe('format', () => {
  it('headline, starter state (DR4)', () => {
    const h = plannedHeadline({ estimate: null, gateWeightMarks: 4 });
    expect(h.headline).toBe('Topics worth 4 marks in GATE');
    expect(h.basisTail).toBe('from GATE topic weights. Your marks estimate appears after the mock or 30 answers.');
  });
  it('headline, estimate state (DR4)', () => {
    const h = plannedHeadline({ estimate: { low: 0.8, high: 1.4, attempts: 34 }, gateWeightMarks: 4 });
    expect(h.headline).toBe('+0.8–1.4 marks');
    expect(h.basisTail).toBe('estimate from 34 attempts');
  });
  it('the win line is a count, never an estimate (DR12, T35)', () => {
    const line = winLine({ right: 3, total: 4, topicNoun: 'eigenvalue' });
    expect(line).toBe("Right. That's 3 of 4 eigenvalue items this week.");
    expect(line).not.toMatch(/mark|\+|estimate|~/i);
  });
  it('formats the clock and never goes negative', () => {
    expect(formatClock(31 * 60 + 10)).toBe('0:31:10');
    expect(formatClock(3600 + 5)).toBe('1:00:05');
    expect(formatClock(-4)).toBe('0:00:00');
  });
  it('signed marking chip', () => {
    expect(markingChip(1, '−⅓')).toBe('+1 · −⅓');
    expect(markingChip(2, '0')).toBe('+2 · 0');
  });
});
