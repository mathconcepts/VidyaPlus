import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MockBriefScreen } from './MockBriefScreen';
import { MockRunningScreen, announcement } from './MockRunningScreen';
import { MockResultScreen } from './MockResultScreen';
import { MockReviewScreen } from './MockReviewScreen';
import { FakeExamApi } from '../api/fake';
import { setViewport } from '../test-utils';

describe('MockBriefScreen (M1, DR6)', () => {
  it('open: two numbers and four rules, read from the data', async () => {
    render(<MockBriefScreen api={new FakeExamApi()} onStart={() => {}} />);
    expect(await screen.findByText('54')).toBeInTheDocument();
    expect(screen.getByText('questions · 30 marks')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('One scored attempt')).toBeInTheDocument();
    expect(screen.getByText('Answers unlock for everyone on Sun 20 Dec')).toBeInTheDocument();
    expect(screen.getByText(/unproctored practice mock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start mock' })).toBeInTheDocument();
  });
  it('before open: "Opens Sun 13 Dec", no start', async () => {
    render(<MockBriefScreen api={new FakeExamApi({ phase: 'before-open' })} onStart={() => {}} />);
    expect(await screen.findByText('Opens Sun 13 Dec')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start/ })).not.toBeInTheDocument();
  });
  it('after close, a non-taker gets "Practice mock · unscored" and nothing "late"', async () => {
    const onStart = vi.fn();
    render(<MockBriefScreen api={new FakeExamApi({ phase: 'closed', taken: 'none' })} onStart={onStart} />);
    expect(await screen.findByText('Practice mock · unscored')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/late answers marked/i);
    fireEvent.click(screen.getByRole('button', { name: 'Start practice mock' }));
    expect(onStart).toHaveBeenCalledWith(true);
  });
  it('locked access: a mock in progress can be finished, a new one cannot be started', async () => {
    const { unmount } = render(<MockBriefScreen api={new FakeExamApi({ taken: 'in-progress' })} locked onStart={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Resume mock' })).toBeInTheDocument();
    unmount();
    render(<MockBriefScreen api={new FakeExamApi({ taken: 'none' })} locked onStart={() => {}} />);
    expect(await screen.findByText('New mocks are locked. Your marks history is still here.')).toBeInTheDocument();
  });
});

describe('MockRunningScreen (M2-M5, DR16, DR18)', () => {
  async function start(msLeft = 54 * 60_000, width = 360, extra: Partial<React.ComponentProps<typeof MockRunningScreen>> = {}) {
    setViewport(width);
    const api = new FakeExamApi({ mockMsLeft: msLeft });
    const attempt = await api.startMock();
    const onSubmitted = vi.fn();
    render(<MockRunningScreen api={api} attempt={attempt} onSubmitted={onSubmitted} {...extra} />);
    return { api, onSubmitted };
  }

  it('shows the server clock as h:mm:ss, grey above 10:00', async () => {
    await start(31 * 60_000 + 10_000);
    const t = screen.getByRole('timer');
    expect(t.textContent).toBe('0:31:10');
    expect(t.className).not.toContain('timer-red');
    expect(screen.getByText('1 of 18')).toBeInTheDocument();
  });

  it('turns red-ink under 10:00 and only then', async () => {
    vi.useFakeTimers();
    try {
      await start(10 * 60_000 + 2000);
      expect(screen.getByRole('timer').className).not.toContain('timer-red');
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(screen.getByRole('timer').textContent).toBe('0:09:59');
      expect(screen.getByRole('timer').className).toContain('timer-red');
    } finally { vi.useRealTimers(); }
  });

  it('announces only at 30, 10 and 5 minutes left (DR17)', () => {
    expect(announcement(54 * 60)).toBe('');
    expect(announcement(31 * 60)).toBe('');
    expect(announcement(30 * 60)).toBe('30 minutes left');
    expect(announcement(15 * 60)).toBe('30 minutes left');
    expect(announcement(10 * 60)).toBe('10 minutes left');
    expect(announcement(5 * 60)).toBe('5 minutes left');
    expect(announcement(0)).toBe('Time is up');
  });

  it('autosaves each answer and says "Saved"; flag and palette update', async () => {
    const { api } = await start();
    fireEvent.click(screen.getByRole('radio', { name: 'Option B' }));
    await screen.findByText(/^Saved ·/);
    expect(api.mockLog.at(-1)).toMatchObject({ itemId: 'mock-01', answer: { kind: 'mcq', key: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
    await waitFor(() => expect(api.mockLog.at(-1)?.flagged).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getByText('answered 1 · blank 17 · flagged 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Question 1, answered, flagged' })).toBeInTheDocument();
  });

  it('"⋯ Report a problem" sends one optional note and replies with the DR18 line', async () => {
    const { api } = await start();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '⋯ Report a problem' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'option C looks odd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent. We review mock reports after the close date. Answer as best you can.')).toBeInTheDocument();
    expect(api.reports[0]).toEqual({ itemId: 'mock-01', note: 'option C looks odd', context: 'mock' });
  });

  it('shows "Offline · N answers waiting" while answers are queued (E3)', async () => {
    await start(54 * 60_000, 360, { waiting: 2 });
    expect(screen.getByText('Offline · 2 answers waiting')).toBeInTheDocument();
  });

  it('submit lists the unanswered questions before anything is sent (M5)', async () => {
    const { api, onSubmitted } = await start();
    fireEvent.click(screen.getByRole('radio', { name: 'Option B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit mock' }));
    expect(screen.getByText(/Unanswered:/).textContent).toContain('2, 3, 4');
    expect(onSubmitted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit mock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit now' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect((await api.getMockBrief()).taken).toBe('submitted');
  });

  it('input locks at the server deadline and the attempt is submitted (E6)', async () => {
    vi.useFakeTimers();
    try {
      const { onSubmitted } = await start(2000);
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(screen.getByRole('timer').textContent).toBe('0:00:00');
      expect(onSubmitted).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('radio', { name: 'Option B' })).toHaveAttribute('aria-disabled', 'true');
    } finally { vi.useRealTimers(); }
  });

  it('NAT question in the mock is keypad-only: no Write button, even with handwriting switched on', async () => {
    vi.stubEnv('VITE_EXAM_HANDWRITING', '1');
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: /^Question 6,/ }));
    expect(await screen.findByLabelText('Your answer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Write|handwriting/i })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  describe('laptop at 1280px (DR16)', () => {
    it('has a fixed side palette, visible key hints and no "Questions" toggle', async () => {
      await start(54 * 60_000, 1280);
      const panel = screen.getByRole('complementary', { name: 'Question palette' });
      expect(within(panel).getAllByRole('button', { name: /^Question \d+/ })).toHaveLength(18);
      expect(screen.queryByRole('button', { name: 'Questions' })).not.toBeInTheDocument();
      expect(document.querySelectorAll('.kbd').length).toBeGreaterThanOrEqual(4);
    });
    it('keys 1-4 / A-D select, F flags, N moves on', async () => {
      const { api } = await start(54 * 60_000, 1280);
      fireEvent.keyDown(window, { key: '2' });
      await waitFor(() => expect(api.mockLog.at(-1)?.answer).toEqual({ kind: 'mcq', key: 'B' }));
      fireEvent.keyDown(window, { key: 'c' });
      await waitFor(() => expect(api.mockLog.at(-1)?.answer).toEqual({ kind: 'mcq', key: 'C' }));
      fireEvent.keyDown(window, { key: 'f' });
      await waitFor(() => expect(api.mockLog.at(-1)?.flagged).toBe(true));
      fireEvent.keyDown(window, { key: 'n' });
      expect(await screen.findByText('2 of 18')).toBeInTheDocument();
    });
  });
});

describe('MockResultScreen: before close (DR11)', () => {
  it('shows score, tally, the practice label and the unlock date, and nothing keyed by topic', async () => {
    const api = new FakeExamApi();
    await api.answerMock('a', 'mock-01', { kind: 'mcq', key: 'B' }, false);
    await api.answerMock('a', 'mock-02', { kind: 'mcq', key: 'A' }, false);
    const onBack = vi.fn();
    render(<MockResultScreen api={api} attemptId="a" onBack={onBack} />);
    expect(await screen.findByText(/Unproctored practice mock · submitted 14 Dec/)).toBeInTheDocument();
    expect(screen.getByText('0.67')).toBeInTheDocument();
    expect(screen.getByText(/right ·/).textContent).toBe('1 right · 1 wrong · 16 skipped');
    expect(screen.getByText('Sun 20 Dec')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Eigenvalues|Laplace|Setup error|key/i);
    fireEvent.click(screen.getByRole('button', { name: "Back to today's plan" }));
    expect(onBack).toHaveBeenCalled();
  });
  it('the result payload carries no key-shaped field (T29 contract)', async () => {
    const r = await new FakeExamApi().getMockResult();
    expect(Object.keys(r).sort()).toEqual(['outOf', 'right', 'score', 'skipped', 'submittedOn', 'unlockOn', 'wrong']);
  });
  it('the attempt served to the app contains no answer keys', async () => {
    const a = await new FakeExamApi().startMock();
    expect(JSON.stringify(a)).not.toMatch(/answer_?key|correct|"solution"|"receipt"|"verification"|"reason"/i);
  });
});

describe('MockReviewScreen: after close (DR6)', () => {
  it('lists each item with key, solution and a receipt', async () => {
    render(<MockReviewScreen api={new FakeExamApi({ phase: 'closed', taken: 'submitted' })} />);
    expect(await screen.findByText('Review · answers and receipts')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText(/Key/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Re-checking/)).toBeInTheDocument();
  });
});
