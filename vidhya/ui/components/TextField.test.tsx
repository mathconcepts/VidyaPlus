import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextField } from './TextField';

describe('TextField', () => {
  it('labels the input and reports changes', () => {
    const onChange = vi.fn();
    render(<TextField label="Your answer" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith('2.5');
  });

  it("passes inputMode 'none' through so the system keyboard stays closed", () => {
    render(<TextField ariaLabel="Answer" inputMode="none" />);
    expect(screen.getByLabelText('Answer')).toHaveAttribute('inputmode', 'none');
  });

  it('links a hint through aria-describedby and flags invalid input', () => {
    render(<TextField ariaLabel="Answer" describedBy="h" invalid hint="enter a number" />);
    const input = screen.getByLabelText('Answer');
    expect(input).toHaveAttribute('aria-describedby', 'h');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it("ring 'ink' draws the focus ring in ink, not indigo", () => {
    const { container } = render(<TextField ariaLabel="Answer" ring="ink" />);
    fireEvent.focus(screen.getByLabelText('Answer'));
    const wrap = container.querySelector('label > span') as HTMLElement;
    expect(wrap.getAttribute('style')).toContain('var(--ink)');
    expect(wrap.getAttribute('style')).not.toContain('--indigo');
  });

  it('forwards key presses', () => {
    const onKeyDown = vi.fn();
    render(<TextField ariaLabel="Answer" onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByLabelText('Answer'), { key: '7' });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
