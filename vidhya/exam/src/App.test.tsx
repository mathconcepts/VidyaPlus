import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { App } from './App';
import { FakeExamApi } from './api/fake';
import type { ExamApi } from './api/types';
import { setViewport } from './test-utils';

describe('App shell: phone (< 768px, DR3, DR16)', () => {
  it('has three tabs in a bottom tab bar, a "← Tutor" link and the screen title', async () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} />);
    const nav = screen.getByRole('navigation', { name: 'Exam sections' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Today', 'Mock', 'Marks']);
    expect(within(nav).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '← Tutor' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
  it('"Practice" is never a tab', () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} />);
    expect(screen.queryByRole('button', { name: /^Practice$/ })).not.toBeInTheDocument();
  });
  it('switches between Today, Mock and Marks', async () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Marks' }));
    expect(await screen.findByText('Why marks are lost')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
    expect(await screen.findByRole('button', { name: 'Start mock' })).toBeInTheDocument();
  });
});

describe('App shell: laptop (>= 768px, DR16)', () => {
  it('swaps the tab bar for a top segmented control and keeps one 640px column', async () => {
    setViewport(1024);
    render(<App api={new FakeExamApi()} />);
    const tabs = screen.getByRole('tablist', { name: 'Exam sections' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Today', 'Mock', 'Marks']);
    expect(screen.queryByRole('navigation', { name: 'Exam sections' })).not.toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Today' }).style.height).toBe('48px');
    await screen.findByRole('button', { name: 'Start' });
    expect(document.querySelector('.col')).not.toBeNull();
    const css = fs.readFileSync(path.resolve(__dirname, 'styles/exam.css'), 'utf8');
    expect(css).toMatch(/\.col\s*\{[^}]*max-width:\s*640px/);
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Marks' }));
    expect(await screen.findByText('Why marks are lost')).toBeInTheDocument();
  });
});

describe('App flows', () => {
  it('Start opens the question screen and the close button returns to Today', async () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('1 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close and go back to Today' }));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('full mock: brief, running, submit, result before close, back to today', async () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start mock' }));
    expect(await screen.findByRole('timer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Option B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit mock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit now' }));
    expect(await screen.findByText(/Unproctored practice mock · submitted/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Exam sections' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Back to today's plan" }));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('after close, a taker\'s Mock tab becomes Review (DR6)', async () => {
    setViewport(360);
    render(<App api={new FakeExamApi({ phase: 'closed', taken: 'submitted' })} />);
    const nav = screen.getByRole('navigation', { name: 'Exam sections' });
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Review' })).toBeInTheDocument());
    fireEvent.click(within(nav).getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('Review · answers and receipts')).toBeInTheDocument();
  });

  it('access ended (DR7): banner, Today locked, Marks still readable', async () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} access={{ endedOn: '31 Dec', renewHref: 'https://t.me/example' }} />);
    expect(screen.getByRole('status').textContent).toContain('Your access ended on 31 Dec. Your marks history is still here.');
    expect(await screen.findByText('New items are locked. Your marks history is still here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marks' }));
    expect(await screen.findByText('Why marks are lost')).toBeInTheDocument();
  });

  it('release banner: one sentence, one action', () => {
    setViewport(360);
    render(<App api={new FakeExamApi()} releaseAvailable />);
    expect(screen.getByRole('status').textContent).toBe('Content updated. Refresh to get the new version. Your answers are kept.');
  });

  it('outage banner when the brain cannot be reached (DR8)', async () => {
    setViewport(360);
    const broken = { ...new FakeExamApi(), getMockBrief: () => Promise.reject(new Error('down')), getToday: () => new Promise(() => {}) } as unknown as ExamApi;
    render(<App api={broken} />);
    expect(await screen.findByText(/The Exam page is down for now/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /DeepTutor's Practice and Tutor still work/ })).toBeInTheDocument();
  });

  it('offline check shows the banner and clears it when the result arrives (DR5)', async () => {
    setViewport(360);
    const api = new FakeExamApi();
    api.setOnline(false);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByRole('radio', { name: '1 and 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(screen.getAllByText(/Saved · we'll check it when you're back online/).length).toBeGreaterThan(0));
    await act(async () => { api.setOnline(true); });
    expect(await screen.findByRole('heading', { name: /^Right\./ })).toBeInTheDocument();
    expect(screen.queryByText(/You can keep going/)).not.toBeInTheDocument();
  });
});
