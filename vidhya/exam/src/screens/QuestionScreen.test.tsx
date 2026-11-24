import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionScreen } from './QuestionScreen';
import { FakeExamApi } from '../api/fake';
import type { TodayItemRef } from '../api/types';

const mcq: TodayItemRef = { id: 'gate-ec-017', topicLabel: 'Eigenvalues', kind: 'mcq' };
const nat: TodayItemRef = { id: 'gate-ec-023', topicLabel: 'Laplace', kind: 'nat' };
const msq: TodayItemRef = { id: 'gate-ec-031', topicLabel: 'Eigenvalues', kind: 'msq' };
const withdrawn: TodayItemRef = { id: 'gate-ec-052', topicLabel: 'Probability', kind: 'mcq' };

const setup = (items: TodayItemRef[], api = new FakeExamApi(), onOffline = vi.fn(), onExit = vi.fn()) => {
  render(<QuestionScreen api={api} items={items} onExit={onExit} onOffline={onOffline} />);
  return { api, onOffline, onExit };
};

describe('QuestionScreen', () => {
  it('shows "n of N", the signed marking chip and the verified-set footer', async () => {
    setup([mcq, nat]);
    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('+1 · −⅓')).toBeInTheDocument();
    expect(screen.getByText('#gate-ec-017')).toBeInTheDocument();
    expect(screen.getByText(/Verified set ·/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close and go back to Today' })).toBeInTheDocument();
  });

  it('Check is disabled until an answer is chosen', async () => {
    setup([mcq]);
    const check = await screen.findByRole('button', { name: 'Check' });
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '1 and 3' }));
    expect(check).toBeEnabled();
  });

  it('a correct answer shows the COUNTED win line, the reason and the receipt, and moves focus to the result line', async () => {
    setup([mcq]);
    fireEvent.click(await screen.findByRole('radio', { name: '1 and 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    const line = await screen.findByRole('heading', { name: "Right. That's 3 of 4 eigenvalue items this week." });
    expect(line).toHaveFocus();
    expect(screen.getByText(/Trace 4, determinant 3/)).toBeInTheDocument();
    expect(screen.getByText(/Verified · SymPy \+ Wolfram agree/)).toBeInTheDocument();
    expect(screen.queryByText(/estimate|\+0\./i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask the tutor why' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report wrong key' })).toBeInTheDocument();
  });

  it('a wrong answer says so, shows yours and the key, and the receipt turns neutral', async () => {
    setup([mcq]);
    fireEvent.click(await screen.findByRole('radio', { name: '2 and 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByRole('heading', { name: 'Not this time.' })).toHaveFocus();
    expect(screen.getByText('B', { selector: 'span.mono' })).toBeInTheDocument();
    expect(screen.getByText('A', { selector: 'span.mono' })).toBeInTheDocument();
    const border = screen.getByText(/Verified · /).closest('div') as HTMLElement;
    expect(border.getAttribute('style')).not.toContain('--receipt-line');
  });

  it('MSQ: a group of checkboxes and a "select all that apply" hint', async () => {
    setup([msq]);
    expect(await screen.findByRole('group')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByText('Select all that apply')).toBeInTheDocument();
  });

  it('a pending item shows the orange re-check receipt after Check', async () => {
    setup([msq]);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'All eigenvalues are real' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'It is orthogonally diagonalisable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Re-checking · one engine disagreed. You can still practise it.')).toBeInTheDocument();
    expect(screen.queryByText(/Verified ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified set/)).not.toBeInTheDocument();
  });

  it('a withdrawn item says so and offers Done, with no Check', async () => {
    const { onExit } = setup([withdrawn]);
    expect(await screen.findByText(/Withdrawn while we re-check/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('NAT: keypad answer is checked and graded with the shared parser', async () => {
    setup([nat]);
    await screen.findByLabelText('Your answer');
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText(/Reads as/).textContent).toContain('Reads as 3');
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByRole('heading', { name: /^Right\./ })).toBeInTheDocument();
  });

  it('offline (DR5): saved in place, Next stays enabled, and the result appears when the network returns', async () => {
    const api = new FakeExamApi();
    api.setOnline(false);
    const { onOffline } = setup([mcq, nat], api);
    fireEvent.click(await screen.findByRole('radio', { name: '1 and 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText("Saved · we'll check it when you're back online")).toBeInTheDocument();
    expect(onOffline).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await act(async () => { api.setOnline(true); });
    expect(await screen.findByRole('heading', { name: /^Right\./ })).toBeInTheDocument();
    expect(onOffline).toHaveBeenLastCalledWith(false);
  });

  it('"Checking…" is words, never a lone spinner, and past 2.5 s says the answer is saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = new FakeExamApi({ latencyMs: 4000 });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<QuestionScreen api={api} items={[mcq]} onExit={() => {}} onOffline={() => {}} />);
      // getItem has the same latency.
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      await user.click(screen.getByRole('radio', { name: '1 and 3' }));
      await user.click(screen.getByRole('button', { name: 'Check' }));
      expect(screen.getByText('Checking…')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
      expect(screen.getByText('Still checking. Your answer is saved.')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      await waitFor(() => expect(screen.getByRole('heading', { name: /^Right\./ })).toBeInTheDocument());
    } finally { vi.useRealTimers(); }
  });

  it('Next walks the plan and Done leaves it', async () => {
    const { onExit } = setup([mcq]);
    fireEvent.click(await screen.findByRole('radio', { name: '1 and 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('Report wrong key opens the report sheet and sends it', async () => {
    const { api } = setup([mcq]);
    fireEvent.click(await screen.findByRole('radio', { name: '1 and 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Report wrong key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.reports).toHaveLength(1));
    expect(api.reports[0]).toMatchObject({ itemId: 'gate-ec-017', context: 'item' });
  });
});
