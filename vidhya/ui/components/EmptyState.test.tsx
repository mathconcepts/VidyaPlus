import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows the title, body and action', () => {
    render(<EmptyState title="Take the mock to see your marks range" body="It opens Sun 13 Dec." action={<button>Open mock</button>} />);
    expect(screen.getByText('Take the mock to see your marks range')).toBeInTheDocument();
    expect(screen.getByText('It opens Sun 13 Dec.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open mock' })).toBeInTheDocument();
  });

  it('omits body and action when not given', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
