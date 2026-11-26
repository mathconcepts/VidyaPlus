import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { App } from './App';
import { Root } from './Root';
import { MarksScreen } from './screens/MarksScreen';
import { ResultPanel } from './components/ResultPanel';
import { FakeExamApi } from './api/fake';
import { ExamApiError, DOWN_COPY } from './api/errors';
import { HttpExamApi } from './api/http';
import type { CheckResult, ExamApi, MarksView } from './api/types';
import { setViewport } from './test-utils';

const withMarks = (m: MarksView): ExamApi => Object.assign(new FakeExamApi(), { getMarks: async () => m });

describe('Marks screen, brain shape', () => {
  it('needs_more: shows the brain sentence and no range', async () => {
    setViewport(360);
    render(<MarksScreen api={withMarks({ status: 'needs_more', range: null, basis: 'Take the mock to see your marks range.', lastWeek: null, lost: [], taxonomy: [] })} />);
    expect(await screen.findByText('Take the mock to see your marks range')).toBeInTheDocument();
  });
  it('ok: range, "estimate from N attempts", counted taxonomy with Unclassified shown openly', async () => {
    setViewport(360);
    render(<MarksScreen api={withMarks({
      status: 'ok', range: { low: 6.5, high: 9, of: 15 }, basis: 'estimate from 34 attempts', lowN: false, lastWeek: null, lost: [],
      taxonomy: [{ bucket: 'CALC', label: 'Arithmetic slip', wrong: 4 }, { bucket: 'UNCLASSIFIED', label: 'Unclassified', wrong: 3 }],
    })} />);
    expect(await screen.findByText(/estimate from 34 attempts/)).toBeInTheDocument();
    expect(screen.getByText('6.5–9')).toBeInTheDocument();
    expect(screen.getByText('Unclassified')).toBeInTheDocument();
    expect(screen.getByText('3 wrong')).toBeInTheDocument();
  });
  it('says so when few attempts back the range', async () => {
    setViewport(360);
    render(<MarksScreen api={withMarks({ status: 'ok', range: { low: 2, high: 9, of: 15 }, basis: 'estimate from 12 attempts', lowN: true, lastWeek: null, lost: [], taxonomy: [] })} />);
    expect(await screen.findByText(/few attempts so far/)).toBeInTheDocument();
    expect(screen.getByText('No wrong answers to explain yet.')).toBeInTheDocument();
  });
});

describe('server-rendered HTML fields', () => {
  const base: CheckResult = { itemId: 'p1', outcome: 'correct', yours: 'B', key: 'B', reason: 'plain $x$', scored: 1, week: null, verification: { state: 'rechecking' } };
  const item = { id: 'p1', topic: 't', topicLabel: 'T', kind: 'mcq', marks: 1, negative: '−⅓', stemHtml: 's', fingerprint: 'f', verification: { state: 'rechecking' } } as never;
  it('reasonHtml is rendered as markup; without it the plain reason is text, never markup', () => {
    const { container, rerender } = render(<ResultPanel item={item} result={{ ...base, reasonHtml: '<span class="katex">x</span>' }} onNext={() => {}} nextLabel="Next" focusRef={{ current: null }} onReport={() => {}} />);
    expect(container.querySelector('span.katex')).not.toBeNull();
    rerender(<ResultPanel item={item} result={{ ...base, reason: '<b>not markup</b>' }} onNext={() => {}} nextLabel="Next" focusRef={{ current: null }} onReport={() => {}} />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>not markup</b>')).toBeInTheDocument();
  });
});

describe('outage and queue wiring in the shell', () => {
  it('a network failure shows the DR8 outage banner; a brain refusal (not down) does not', async () => {
    setViewport(360);
    const down = Object.assign(new FakeExamApi(), { getMockBrief: async () => { throw new ExamApiError('Offline', DOWN_COPY, { down: true }); } });
    const { unmount } = render(<App api={down} />);
    expect(await screen.findByText(/The Exam page is down for now/)).toBeInTheDocument();
    unmount();
    const refused = Object.assign(new FakeExamApi(), { getMockBrief: async () => { throw new ExamApiError('MockFormUnknown', 'this pack has no mock', { status: 404 }); } });
    render(<App api={refused} />);
    await screen.findByRole('button', { name: 'Start' });
    expect(screen.queryByText(/The Exam page is down for now/)).toBeNull();
  });
  it('answers waiting on the device show the offline banner (DR5)', async () => {
    setViewport(360);
    let push: (n: number) => void = () => {};
    const api = Object.assign(new FakeExamApi(), { onWaiting: (l: (n: number) => void) => { push = l; return () => {}; } });
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Start' });
    act(() => push(2));
    expect(screen.getByText(/Saved · we'll check it when you're back online/)).toBeInTheDocument();
  });
  it('E10: a build mismatch from the HttpExamApi shows the refresh banner', async () => {
    setViewport(360);
    const api = new HttpExamApi({ buildId: 'b1', storage: null, onOnline: () => undefined, fetchImpl: (async (u: string) => new Response(u === '/v1/today' ? JSON.stringify({ minutes: 30, items: [], topics: [], gateWeightMarks: 0, estimate: null, mockLine: '', continueRow: null, withdrawnCount: 0, cleared: true }) : u === '/v1/mock' ? JSON.stringify({ phase: 'open', taken: 'none', opensOn: 'a', closesOn: 'b', unlockOn: 'c', minutes: 1, questions: 1, totalMarks: 1, rules: [] }) : '{"code":"FeatureNotEnabled","message":"off"}', { status: 200, headers: { 'x-vidhya-build': 'b2' } })) as never });
    render(<Root api={api} />);
    expect(await screen.findByText(/Content updated/)).toBeInTheDocument();
  });
});
