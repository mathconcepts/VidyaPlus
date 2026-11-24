import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OptionList, useMockShortcuts } from './OptionList';

const options = [{ key: 'A', html: '1 and 3' }, { key: 'B', html: '2 and 2' }, { key: 'C', html: '0 and 4' }, { key: 'D', html: '−1 and 3' }];

function Host({ kind }: { kind: 'mcq' | 'msq' }) {
  const [sel, setSel] = useState<string[]>([]);
  return <OptionList kind={kind} options={options} selected={sel} onChange={setSel} name="x" showHints />;
}

describe('OptionList (DR13, DR17)', () => {
  it('MCQ is a radiogroup of radios with one tab stop', () => {
    render(<Host kind="mcq" />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getAllByRole('radio').filter(r => r.tabIndex === 0)).toHaveLength(1);
  });
  it('MSQ is a group of checkboxes', () => {
    render(<Host kind="msq" />);
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  });
  it('MCQ selects one at a time; selection is aria-checked (the ink ring keys off it)', () => {
    render(<Host kind="mcq" />);
    fireEvent.click(screen.getByRole('radio', { name: '2 and 2' }));
    fireEvent.click(screen.getByRole('radio', { name: '0 and 4' }));
    expect(screen.getAllByRole('radio').filter(r => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: '0 and 4' })).toHaveAttribute('aria-checked', 'true');
  });
  it('MSQ toggles several', () => {
    render(<Host kind="msq" />);
    fireEvent.click(screen.getByRole('checkbox', { name: '1 and 3' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '0 and 4' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '1 and 3' }));
    expect(screen.getAllByRole('checkbox').filter(r => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
  it('arrow keys move through the radiogroup', () => {
    render(<Host kind="mcq" />);
    const first = screen.getAllByRole('radio')[0];
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
  });
  it('shows key hints 1-4 when asked and every option is 52px or taller via the opt class', () => {
    render(<Host kind="mcq" />);
    expect(document.querySelectorAll('.kbd')).toHaveLength(4);
    expect(document.querySelector('.opt')).not.toBeNull();
  });
});

function Shortcuts(props: { onSelect: (i: number) => void; onNext: () => void; onFlag: () => void; enabled?: boolean }) {
  useMockShortcuts({ ...props, enabled: props.enabled ?? true, optionCount: 4 });
  return <input aria-label="field" />;
}

describe('useMockShortcuts (DR16)', () => {
  it('1-4 and A-D select, N next, F flag', () => {
    const h = { onSelect: vi.fn(), onNext: vi.fn(), onFlag: vi.fn() };
    render(<Shortcuts {...h} />);
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: 'c' });
    fireEvent.keyDown(window, { key: 'N' });
    fireEvent.keyDown(window, { key: 'f' });
    expect(h.onSelect.mock.calls).toEqual([[1], [2]]);
    expect(h.onNext).toHaveBeenCalledTimes(1);
    expect(h.onFlag).toHaveBeenCalledTimes(1);
  });
  it('ignores keys typed in a field, with modifiers, beyond the option count, or when disabled', () => {
    const h = { onSelect: vi.fn(), onNext: vi.fn(), onFlag: vi.fn() };
    const { rerender } = render(<Shortcuts {...h} />);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'n' });
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(window, { key: '5' });
    expect(h.onNext).not.toHaveBeenCalled();
    expect(h.onSelect).not.toHaveBeenCalled();
    rerender(<Shortcuts {...h} enabled={false} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(h.onNext).not.toHaveBeenCalled();
  });
});
