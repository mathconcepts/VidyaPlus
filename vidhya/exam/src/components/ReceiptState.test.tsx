import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReceiptState } from './ReceiptState';

const item = { id: 'gate-ec-017', fingerprint: 'fp-17' };
const verified = { state: 'verified' as const, source: 'SymPy + Wolfram agree · 20 Nov v1', recordFingerprint: 'fp-17', engineLines: ['sympy: ok', 'wolfram: ok'] };

describe('ReceiptState: the five states (DR9, T27)', () => {
  it('verified: green border, tick, and engine lines on tap', () => {
    const { container } = render(<ReceiptState item={item} verification={verified} />);
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText(/Verified · SymPy \+ Wolfram agree · 20 Nov v1/)).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).getAttribute('style')).toContain('--receipt-line');
    expect(screen.queryByText(/sympy: ok/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show engine lines' }));
    expect(screen.getByText(/sympy: ok/)).toBeInTheDocument();
  });
  it('verified inside a wrong answer is neutral, not green', () => {
    const { container } = render(<ReceiptState item={item} verification={verified} wrong />);
    expect((container.firstElementChild as HTMLElement).getAttribute('style')).not.toContain('--receipt-line');
  });
  it('a fingerprint that does not match gets no border and no verified claim (rule 6)', () => {
    const { container } = render(<ReceiptState item={{ ...item, fingerprint: 'changed' }} verification={verified} />);
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    expect(container.querySelector('[style*="inset"]')).toBeNull();
  });
  it('pending: orange tone, "Re-checking" copy', () => {
    const { container } = render(<ReceiptState item={item} verification={{ state: 'rechecking' }} />);
    expect(screen.getByText('Re-checking · one engine disagreed. You can still practise it.')).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).getAttribute('style')).toContain('--receipt-pending-line');
  });
  it('withdrawn: plain text, no border', () => {
    const { container } = render(<ReceiptState item={{ ...item, id: 'gate-ec-041' }} verification={{ state: 'withdrawn' }} />);
    expect(container.textContent).toBe("Withdrawn while we re-check. It won't count against you. #gate-ec-041");
    expect(container.querySelector('[style*="inset"]')).toBeNull();
  });
  it('locked: plain text with the unlock date, no border', () => {
    const { container } = render(<ReceiptState item={item} verification={{ state: 'locked', unlockOn: 'Sun 20 Dec' }} />);
    expect(container.textContent).toBe('Receipt unlocks with the answers on Sun 20 Dec.');
    expect(container.querySelector('[style*="inset"]')).toBeNull();
  });
});
