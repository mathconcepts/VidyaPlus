import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BannerSlot } from './BannerSlot';

describe('BannerSlot (DR5, DR7, DR8, release)', () => {
  it('renders nothing but an empty live region when there is no banner', () => {
    const { container } = render(<BannerSlot banner={null} />);
    expect(container.textContent).toBe('');
  });
  it('offline copy', () => {
    render(<BannerSlot banner={{ kind: 'offline' }} />);
    expect(screen.getByRole('status').textContent).toBe("Saved · we'll check it when you're back online. You can keep going.");
  });
  it('release copy, with one action', () => {
    const onRefresh = vi.fn();
    render(<BannerSlot banner={{ kind: 'release', onRefresh }} />);
    expect(screen.getByRole('status').textContent).toBe('Content updated. Refresh to get the new version. Your answers are kept.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalled();
  });
  it('access-ended copy links to Telegram renewal', () => {
    render(<BannerSlot banner={{ kind: 'access-ended', endedOn: '31 Dec', renewHref: 'https://t.me/example' }} />);
    expect(screen.getByRole('status').textContent).toBe('Your access ended on 31 Dec. Your marks history is still here. Renew on Telegram');
    expect(screen.getByRole('link', { name: 'Renew on Telegram' })).toHaveAttribute('href', 'https://t.me/example');
  });
  it('outage copy links to DeepTutor', () => {
    render(<BannerSlot banner={{ kind: 'outage', tutorHref: '/' }} />);
    expect(screen.getByRole('status').textContent).toBe("The Exam page is down for now. Answers you already saved are safe. DeepTutor's Practice and Tutor still work →");
  });
  it('is never a modal or dialog', () => {
    render(<BannerSlot banner={{ kind: 'offline' }} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
