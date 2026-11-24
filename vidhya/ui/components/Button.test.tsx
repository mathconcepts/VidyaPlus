import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders a button of type "button" and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Start</Button>);
    const b = screen.getByRole('button', { name: 'Start' });
    expect(b).toHaveAttribute('type', 'button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Write</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Write' })).toBeDisabled();
  });

  it("size 'lg' is at least the 48px tap-target floor", () => {
    render(<Button size="lg">Check</Button>);
    expect(parseInt(screen.getByRole('button').style.height, 10)).toBeGreaterThanOrEqual(48);
  });

  it("tone 'action' uses the contrast-safe action tokens, not the 2.2:1 green fill", () => {
    render(<Button tone="action">Start</Button>);
    const style = screen.getByRole('button').getAttribute('style') ?? '';
    expect(style).toContain('--action-solid');
    expect(style).toContain('--on-action');
    expect(style).not.toContain('var(--green)');
  });

  it('exposes an accessible name and key shortcuts', () => {
    render(<Button ariaLabel="Flag question" ariaKeyShortcuts="F">Flag</Button>);
    const b = screen.getByRole('button', { name: 'Flag question' });
    expect(b).toHaveAttribute('aria-keyshortcuts', 'F');
  });
});
