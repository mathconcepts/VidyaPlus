import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { value: 'today', label: 'Today' },
  { value: 'mock', label: 'Mock' },
];

describe('SegmentedControl', () => {
  it('is a tablist with aria-selected on the active segment', () => {
    render(<SegmentedControl options={options} value="mock" ariaLabel="Exam sections" />);
    expect(screen.getByRole('tablist', { name: 'Exam sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mock' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the chosen value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="today" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mock' }));
    expect(onChange).toHaveBeenCalledWith('mock');
  });

  it("size 'lg' gives 48px segments", () => {
    render(<SegmentedControl options={options} value="today" size="lg" />);
    expect(screen.getByRole('tab', { name: 'Today' }).style.height).toBe('48px');
  });
});
