import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodayScreen } from './TodayScreen';
import { FakeExamApi } from '../api/fake';
import type { ExamApi, TodayPlan } from '../api/types';

const noop = () => {};

describe('TodayScreen (DR3, DR4, T26)', () => {
  it('starter state: GATE-weight headline, plan eyebrow and the basis line', async () => {
    render(<TodayScreen api={new FakeExamApi()} onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(await screen.findByRole('heading', { name: 'Topics worth 4 marks in GATE' })).toBeInTheDocument();
    expect(screen.getByText('Starter plan · 30 min · 4 items')).toBeInTheDocument();
    expect(screen.getByText('Eigenvalues, Laplace · from GATE topic weights. Your marks estimate appears after the mock or 30 answers.')).toBeInTheDocument();
  });

  it('estimate state: switches to the marks range after 30 attempts or the mock', async () => {
    render(<TodayScreen api={new FakeExamApi({ today: 'estimate' })} onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(await screen.findByRole('heading', { name: '+0.8–1.4 marks' })).toBeInTheDocument();
    expect(screen.getByText("Today's plan · 30 min · 4 items")).toBeInTheDocument();
    expect(screen.getByText('Eigenvalues, Laplace · estimate from 34 attempts')).toBeInTheDocument();
    expect(screen.queryByText(/Topics worth/)).not.toBeInTheDocument();
  });

  it('shows exactly one hero action, the mock line, and the two pick-up rows', async () => {
    const onStart = vi.fn(); const onPractise = vi.fn(); const onContinue = vi.fn();
    render(<TodayScreen api={new FakeExamApi()} onStart={onStart} onPractise={onPractise} onContinue={onContinue} />);
    await screen.findByRole('button', { name: 'Start' });
    expect(screen.getByText('Mock opens Sun 13 Dec')).toBeInTheDocument();
    expect(screen.getByText('Pick up')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue NAT · Laplace/ }));
    fireEvent.click(screen.getByRole('button', { name: /Practise a topic/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onContinue).toHaveBeenCalled(); expect(onPractise).toHaveBeenCalled(); expect(onStart).toHaveBeenCalled();
  });

  it('has no Continue row when nothing is in progress', async () => {
    const api = new FakeExamApi();
    const base = await api.getToday();
    const stub = { ...api, getToday: async (): Promise<TodayPlan> => ({ ...base, continueRow: null }) } as unknown as ExamApi;
    render(<TodayScreen api={stub} onStart={noop} onPractise={noop} onContinue={noop} />);
    await screen.findByRole('button', { name: 'Start' });
    expect(screen.queryByText(/Continue/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Practise a topic/ })).toBeInTheDocument();
  });

  it('loading is a static skeleton, no spinner', () => {
    render(<TodayScreen api={new FakeExamApi({ latencyMs: 5000 })} onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(screen.getByLabelText("Loading today's plan")).toHaveAttribute('aria-busy', 'true');
  });

  it('partial: a withdrawn item is named under the headline', async () => {
    const api = new FakeExamApi();
    const base = await api.getToday();
    const stub = { ...api, getToday: async () => ({ ...base, withdrawnCount: 1 }) } as unknown as ExamApi;
    render(<TodayScreen api={stub} onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(await screen.findByText('1 item withdrawn while we re-check')).toBeInTheDocument();
  });

  it('empty: cleared items point to the mock before close and to practice after', async () => {
    const api = new FakeExamApi();
    const base = await api.getToday();
    const stub = { ...api, getToday: async () => ({ ...base, cleared: true }) } as unknown as ExamApi;
    const { unmount } = render(<TodayScreen api={stub} mockPhase="open" onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(await screen.findByText('You’ve cleared today’s best items. Take the mock')).toBeInTheDocument();
    unmount();
    render(<TodayScreen api={stub} mockPhase="closed" onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(await screen.findByText('You’ve cleared today’s best items.')).toBeInTheDocument();
  });

  it('access ended (DR7): Start and the rows are gone, history is mentioned', async () => {
    render(<TodayScreen api={new FakeExamApi()} locked onStart={noop} onPractise={noop} onContinue={noop} />);
    expect(await screen.findByText('New items are locked. Your marks history is still here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByText('Pick up')).not.toBeInTheDocument();
  });
});
