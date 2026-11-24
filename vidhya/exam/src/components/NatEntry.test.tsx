import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NatEntry, pressKey, readsAs } from './NatEntry';

function Host({ showWrite = true }: { showWrite?: boolean }) {
  const [v, setV] = useState('');
  return <NatEntry value={v} onChange={setV} markingNote="no negative marks · blank counts as skipped" showWrite={showWrite} />;
}
const field = () => screen.getByLabelText('Your answer') as HTMLInputElement;

describe('NatEntry (DR15, T30)', () => {
  it('the field is inputmode="none" so the system keyboard never opens', () => {
    render(<Host />);
    expect(field()).toHaveAttribute('inputmode', 'none');
  });

  it('lays the keypad out GATE-style: 7-8-9 first, then 0, ".", "−", Clear, ⌫', () => {
    render(<Host />);
    const labels = Array.from(screen.getByRole('group', { name: 'Number keypad' }).querySelectorAll('button')).map(b => b.textContent);
    expect(labels).toEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '−', 'Clear', '⌫']);
  });

  it('keypad taps build the value and "Reads as" shows what will be graded', () => {
    render(<Host />);
    for (const k of ['−', '2', '.', '5']) fireEvent.click(screen.getByRole('button', { name: k === '−' ? 'Minus' : k === '.' ? 'Decimal point' : k }));
    expect(field().value).toBe('-2.5');
    expect(screen.getByText(/Reads as/).textContent).toContain('Reads as −2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(field().value).toBe('-2.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(field().value).toBe('');
  });

  it('physical keys work: digits, "." and "-"; letters are refused', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.keyboard('-0.5x');
    expect(field().value).toBe('-0.5');
  });

  it('a comma is refused with a hint: only "." is a decimal point', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.keyboard('3,');
    expect(field().value).toBe('3');
    expect(screen.getByText(/Use a full stop/)).toBeInTheDocument();
    await user.keyboard('5');
    expect(field().value).toBe('35');
  });

  it('a pasted "3,5" is flagged inline, not graded', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '3,5' } });
    expect(screen.getByText(/Doesn't read as a number yet/)).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('reads like the grader does: -0.5, .5, 3. all parse', () => {
    expect(readsAs('-0.5')).toEqual({ state: 'ok', text: '−0.5' });
    expect(readsAs('.5')).toEqual({ state: 'ok', text: '0.5' });
    expect(readsAs('3.')).toEqual({ state: 'ok', text: '3' });
    expect(readsAs('3,5').state).toBe('bad');
    expect(readsAs('').state).toBe('empty');
  });

  it('pressKey rules: one point, a toggling minus, leading zero before a bare point', () => {
    expect(pressKey('1.5', '.')).toBe('1.5');
    expect(pressKey('', '.')).toBe('0.');
    expect(pressKey('-', '.')).toBe('-0.');
    expect(pressKey('2', '−')).toBe('-2');
    expect(pressKey('-2', '−')).toBe('2');
  });

  it('Write is a disabled placeholder (T31 is out of scope) and is absent in the mock', () => {
    const { unmount } = render(<Host />);
    expect(screen.getByRole('button', { name: /Write your answer/ })).toBeDisabled();
    unmount();
    render(<Host showWrite={false} />);
    expect(screen.queryByRole('button', { name: /Write/ })).not.toBeInTheDocument();
  });
});
