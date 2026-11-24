import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

const items = [
  { value: 'today', label: 'Today' },
  { value: 'mock', label: 'Mock' },
  { value: 'marks', label: 'Marks' },
];

describe('TabBar', () => {
  it('is a labelled nav landmark and marks the active tab with aria-current', () => {
    render(<TabBar items={items} value="mock" ariaLabel="Exam sections" />);
    expect(screen.getByRole('navigation', { name: 'Exam sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mock' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Today' })).not.toHaveAttribute('aria-current');
  });

  it('reports the tapped value', () => {
    const onChange = vi.fn();
    render(<TabBar items={items} value="today" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Marks' }));
    expect(onChange).toHaveBeenCalledWith('marks');
  });

  it("activeTone 'ink' keeps indigo off the active tab; the default stays indigo for the legacy app", () => {
    const { rerender } = render(<TabBar items={items} value="today" activeTone="ink" />);
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('style')).not.toContain('--indigo');
    rerender(<TabBar items={items} value="today" />);
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('style')).toContain('--indigo-ink');
  });
});
