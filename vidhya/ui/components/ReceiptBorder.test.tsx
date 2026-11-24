/**
 * ReceiptBorder tests — the "receipt aesthetic" trust marker.
 *
 * Only one behavior actually matters here and it's the one the design
 * review flagged as easy to violate elsewhere: the bordered/✓ surface must
 * be strictly gated on `receipt.verified`, never on the mere presence of a
 * receipt prop or on the caller's intent. No receipt object (or
 * verified: false) → no border, by construction.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceiptBorder } from './ReceiptBorder';
import { receiptFromRecheck, receiptFromItemRecord } from '../lib/receipt';

describe('ReceiptBorder', () => {
  it('renders no border/checkmark when receipt is null', () => {
    render(
      <ReceiptBorder receipt={null}>
        <span>Estimate</span>
      </ReceiptBorder>,
    );
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('renders no border/checkmark when receipt is undefined', () => {
    render(
      <ReceiptBorder receipt={undefined}>
        <span>Estimate</span>
      </ReceiptBorder>,
    );
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('renders no border/checkmark when receipt.verified is false', () => {
    render(
      <ReceiptBorder receipt={{ verified: false, source: 'not_actually_checked' }}>
        <span>Estimate</span>
      </ReceiptBorder>,
    );
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('renders the border + checkmark only when receipt.verified is true', () => {
    render(
      <ReceiptBorder receipt={{ verified: true, source: 'cas_verifier' }}>
        <span>Verified answer</span>
      </ReceiptBorder>,
    );
    expect(screen.getByText('Verified answer')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  // /investigate (2026-09-02): PracticeAttemptPage nests a green-tick
  // ReceiptBorder inside a red "wrong answer" card. receiptFromServerGrade
  // deliberately attests the GRADE not the correctness, but a green
  // checkmark still reads as "you got it right" to a student regardless of
  // that distinction, colliding with the red card right next to it.
  it("tone='neutral' drops the green ink so a receipt inside a wrong-answer card doesn't read as a correctness signal", () => {
    render(
      <ReceiptBorder receipt={{ verified: true, source: 'gate_deterministic_scorer' }} tone="neutral">
        <span>Not this time</span>
      </ReceiptBorder>,
    );
    // The checkmark's parent is the styled "Verified · {source}" label span.
    const label = screen.getByText('✓').parentElement as HTMLElement;
    expect(label.textContent).toContain('Verified · gate_deterministic_scorer');
    expect(label.getAttribute('style')).not.toContain('--green-ink');
  });

  it("tone defaults to 'positive' (unchanged green ink) when omitted", () => {
    render(
      <ReceiptBorder receipt={{ verified: true, source: 'cas_verifier' }}>
        <span>Verified answer</span>
      </ReceiptBorder>,
    );
    const label = screen.getByText('✓').parentElement as HTMLElement;
    expect(label.getAttribute('style')).toContain('--green-ink');
  });

  it("tone='neutral' also drops the checkmark disc's own green background (--receipt-mark), not just the label ink", () => {
    render(
      <ReceiptBorder receipt={{ verified: true, source: 'gate_deterministic_scorer' }} tone="neutral">
        <span>Not this time</span>
      </ReceiptBorder>,
    );
    const mark = screen.getByText('✓');
    expect(mark.getAttribute('style')).not.toContain('--receipt-mark');
    expect(mark.getAttribute('style')).toContain('--text-tertiary');
  });

  it('reads border color from the DESIGN-SYSTEM CSS custom properties, not a hardcoded class', () => {
    const { container } = render(
      <ReceiptBorder receipt={{ verified: true, source: 'cas_verifier' }}>
        <span>Verified answer</span>
      </ReceiptBorder>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    // Regression guard for the design-review finding: hardcoded emerald
    // Tailwind classes silently drift from DESIGN-SYSTEM.md's token if
    // that token is ever re-themed. Asserting the inline style references
    // the CSS var (rather than a literal color) keeps the two in sync.
    expect(wrapper.getAttribute('style')).toContain('--receipt-line');
  });

  // /ship review-army (2026-09-02): tone='neutral' recolored the ink and
  // checkmark disc but left this outer card border hardcoded to the green
  // --receipt-line token, so a wrong-answer receipt still wore a
  // green-bordered card — the exact collision the tone prop exists to remove.
  it("tone='neutral' also swaps the outer card's border away from the green --receipt-line token", () => {
    const { container } = render(
      <ReceiptBorder receipt={{ verified: true, source: 'gate_deterministic_scorer' }} tone="neutral">
        <span>Not this time</span>
      </ReceiptBorder>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('style')).not.toContain('--receipt-line');
    expect(wrapper.getAttribute('style')).toContain('--separator');
  });

  // DR9 (plan section 21): the third tone, for an item under re-check.
  describe("tone='pending'", () => {
    const pending = receiptFromRecheck({ status: 'rechecking' });

    it('draws the orange border, the ... disc and the Re-checking copy for a pending receipt', () => {
      const { container } = render(
        <ReceiptBorder receipt={pending} tone="pending">
          <span>Item body</span>
        </ReceiptBorder>,
      );
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.getAttribute('style')).toContain('--receipt-pending-line');
      expect(wrapper.getAttribute('style')).not.toContain('--receipt-line)');
      const disc = screen.getByText('…');
      expect(disc.getAttribute('style')).toContain('--orange)');
      expect(screen.getByText(/Re-checking · one engine disagreed\. You can still practise it\./)).toBeInTheDocument();
      expect(screen.getByText(/Re-checking/).getAttribute('style')).toContain('--orange-ink');
      expect(screen.queryByText('✓')).not.toBeInTheDocument();
      expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    });

    it('a pending receipt is pending whatever tone the caller passes', () => {
      render(
        <ReceiptBorder receipt={pending}>
          <span>Item body</span>
        </ReceiptBorder>,
      );
      expect(screen.getByText('…')).toBeInTheDocument();
      expect(screen.queryByText('✓')).not.toBeInTheDocument();
    });

    it('no receipt, no border: a null pending receipt renders the children bare', () => {
      const { container } = render(
        <ReceiptBorder receipt={receiptFromRecheck({ status: 'verified' })} tone="pending">
          <span>Item body</span>
        </ReceiptBorder>,
      );
      expect(container.firstElementChild?.tagName).toBe('SPAN');
      expect(screen.queryByText('…')).not.toBeInTheDocument();
    });

    it("a verified receipt asked to wear 'pending' stays a green verified receipt, never an orange one", () => {
      render(
        <ReceiptBorder receipt={{ verified: true, source: 'cas_verifier' }} tone="pending">
          <span>Item body</span>
        </ReceiptBorder>,
      );
      expect(screen.getByText('✓')).toBeInTheDocument();
      expect(screen.queryByText('…')).not.toBeInTheDocument();
    });

    it('a record that is not under re-check mints no pending receipt', () => {
      expect(receiptFromRecheck(null)).toBeNull();
      expect(receiptFromRecheck({ status: 'verified' })).toBeNull();
    });
  });

  // Rule 6, "receipts never lie": a verified receipt needs a record whose fingerprint matches the item.
  describe('receiptFromItemRecord', () => {
    const rec = { status: 'verified', source: 'SymPy + Wolfram agree', recordFingerprint: 'abc' };
    it('mints a receipt only when the record is verified and its fingerprint matches the item', () => {
      expect(receiptFromItemRecord(rec, 'abc')).toEqual({ verified: true, source: 'SymPy + Wolfram agree' });
      expect(receiptFromItemRecord(rec, 'xyz')).toBeNull();
      expect(receiptFromItemRecord({ ...rec, status: 'disputed' }, 'abc')).toBeNull();
      expect(receiptFromItemRecord(null, 'abc')).toBeNull();
      expect(receiptFromItemRecord(rec, '')).toBeNull();
    });
  });
});
