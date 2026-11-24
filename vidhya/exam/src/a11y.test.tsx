/**
 * Accessibility gate (T33, DR17): axe-core over every screen, in light and dark.
 * 0 serious or critical violations. jsdom has no layout engine, so axe cannot compute
 * colour contrast here; `contrast.test.ts` checks the token pairs instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { App } from './App';
import { FakeExamApi } from './api/fake';
import { BannerSlot } from './components/BannerSlot';
import { ReceiptState } from './components/ReceiptState';
import { MarksScreen } from './screens/MarksScreen';
import { MockBriefScreen } from './screens/MockBriefScreen';
import { MockResultScreen } from './screens/MockResultScreen';
import { MockReviewScreen } from './screens/MockReviewScreen';
import { MockRunningScreen } from './screens/MockRunningScreen';
import { PractiseScreen } from './screens/PractiseScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { TodayScreen } from './screens/TodayScreen';
import { setViewport } from './test-utils';

async function violations(container: HTMLElement) {
  const res = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    resultTypes: ['violations'],
  });
  return res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
}
const fmt = (v: Awaited<ReturnType<typeof violations>>) => v.map(x => `${x.id}: ${x.nodes.map(n => n.html.slice(0, 80)).join(' | ')}`).join('\n');

const noop = () => {};
type Case = { name: string; ui: () => ReactElement; ready: () => Promise<unknown>; width?: number; act?: () => void };

const cases: Case[] = [
  { name: 'Today (starter)', ui: () => <TodayScreen api={new FakeExamApi()} onStart={noop} onPractise={noop} onContinue={noop} />, ready: () => screen.findByRole('button', { name: 'Start' }) },
  { name: 'Today (estimate)', ui: () => <TodayScreen api={new FakeExamApi({ today: 'estimate' })} onStart={noop} onPractise={noop} onContinue={noop} />, ready: () => screen.findByText('+0.8–1.4 marks') },
  { name: 'Today (access ended)', ui: () => <TodayScreen api={new FakeExamApi()} locked onStart={noop} onPractise={noop} onContinue={noop} />, ready: () => screen.findByText(/New items are locked/) },
  { name: 'Practise a topic', ui: () => <PractiseScreen api={new FakeExamApi()} onOpen={noop} onBack={noop} />, ready: () => screen.findByText('Laplace') },
  { name: 'Question (MCQ)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-017', topicLabel: 'Eigenvalues', kind: 'mcq' }]} onExit={noop} onOffline={noop} />, ready: () => screen.findByRole('radiogroup') },
  { name: 'Question (MSQ)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-031', topicLabel: 'Eigenvalues', kind: 'msq' }]} onExit={noop} onOffline={noop} />, ready: () => screen.findByRole('group') },
  { name: 'Question (NAT keypad)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-023', topicLabel: 'Laplace', kind: 'nat' }]} onExit={noop} onOffline={noop} />, ready: () => screen.findByLabelText('Your answer') },
  { name: 'Result (correct)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-017', topicLabel: 'Eigenvalues', kind: 'mcq' }]} onExit={noop} onOffline={noop} />, ready: async () => { fireEvent.click(await screen.findByRole('radio', { name: '1 and 3' })); fireEvent.click(screen.getByRole('button', { name: 'Check' })); return screen.findByRole('heading', { name: /^Right/ }); } },
  { name: 'Result (wrong, engine lines open)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-017', topicLabel: 'Eigenvalues', kind: 'mcq' }]} onExit={noop} onOffline={noop} />, ready: async () => { fireEvent.click(await screen.findByRole('radio', { name: '2 and 2' })); fireEvent.click(screen.getByRole('button', { name: 'Check' })); await screen.findByRole('heading', { name: 'Not this time.' }); fireEvent.click(screen.getByRole('button', { name: 'Show engine lines' })); } },
  { name: 'Result (pending receipt)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-031', topicLabel: 'Eigenvalues', kind: 'msq' }]} onExit={noop} onOffline={noop} />, ready: async () => { fireEvent.click(await screen.findByRole('checkbox', { name: 'All eigenvalues are real' })); fireEvent.click(screen.getByRole('button', { name: 'Check' })); return screen.findByText(/Re-checking/); } },
  { name: 'Question (withdrawn)', ui: () => <QuestionScreen api={new FakeExamApi()} items={[{ id: 'gate-ec-052', topicLabel: 'Probability', kind: 'mcq' }]} onExit={noop} onOffline={noop} />, ready: () => screen.findByText(/Withdrawn/) },
  { name: 'Mock brief', ui: () => <MockBriefScreen api={new FakeExamApi()} onStart={noop} />, ready: () => screen.findByRole('button', { name: 'Start mock' }) },
  { name: 'Mock brief (before open)', ui: () => <MockBriefScreen api={new FakeExamApi({ phase: 'before-open' })} onStart={noop} />, ready: () => screen.findByText('Opens Sun 13 Dec') },
  { name: 'Mock brief (unscored)', ui: () => <MockBriefScreen api={new FakeExamApi({ phase: 'closed' })} onStart={noop} />, ready: () => screen.findByText('Practice mock · unscored') },
  { name: 'Mock running', ui: () => <Running />, ready: () => screen.findByRole('timer') },
  { name: 'Mock running, laptop with palette', width: 1280, ui: () => <Running />, ready: () => screen.findByRole('complementary') },
  { name: 'Mock palette (phone) and report sheet', ui: () => <Running />, ready: async () => { await screen.findByRole('timer'); fireEvent.click(screen.getByRole('button', { name: 'Questions' })); fireEvent.click(screen.getByRole('button', { name: 'More' })); fireEvent.click(screen.getByRole('menuitem', { name: /Report/ })); } },
  { name: 'Mock submit summary', ui: () => <Running />, ready: async () => { await screen.findByRole('timer'); fireEvent.click(screen.getByRole('button', { name: 'Questions' })); fireEvent.click(screen.getByRole('button', { name: 'Submit mock' })); } },
  { name: 'Mock result before close', ui: () => <MockResultScreen api={new FakeExamApi()} attemptId="a" onBack={noop} />, ready: () => screen.findByText(/Back to today/, { selector: 'button' }) },
  { name: 'Mock review', ui: () => <MockReviewScreen api={new FakeExamApi()} />, ready: () => screen.findByText(/Review ·/) },
  { name: 'Marks', ui: () => <MarksScreen api={new FakeExamApi()} />, ready: () => screen.findByText('Why marks are lost') },
  { name: 'Marks (empty)', ui: () => <MarksScreen api={new FakeExamApi({ marks: 'empty' })} />, ready: () => screen.findByText(/Take the mock/) },
  { name: 'Banners', ui: () => <><BannerSlot banner={{ kind: 'offline' }} /><BannerSlot banner={{ kind: 'release', onRefresh: noop }} /><BannerSlot banner={{ kind: 'access-ended', endedOn: '31 Dec', renewHref: '#' }} /><BannerSlot banner={{ kind: 'outage', tutorHref: '/' }} /></>, ready: async () => {} },
  { name: 'Receipt states', ui: () => { const item = { id: 'x-1', fingerprint: 'f' }; return <><ReceiptState item={item} verification={{ state: 'verified', source: 's', recordFingerprint: 'f', engineLines: ['a'] }} /><ReceiptState item={item} verification={{ state: 'rechecking' }} /><ReceiptState item={item} verification={{ state: 'withdrawn' }} /><ReceiptState item={item} verification={{ state: 'locked', unlockOn: 'Sun 20 Dec' }} /></>; }, ready: async () => {} },
  { name: 'App shell, phone (tab bar)', ui: () => <App api={new FakeExamApi()} />, ready: () => screen.findByRole('button', { name: 'Start' }) },
  { name: 'App shell, laptop (segmented control)', width: 1024, ui: () => <App api={new FakeExamApi()} />, ready: () => screen.findByRole('tablist') },
  { name: 'App shell, access ended banner', ui: () => <App api={new FakeExamApi()} access={{ endedOn: '31 Dec', renewHref: '#' }} />, ready: () => screen.findByText(/Renew on Telegram/) },
];

function Running() {
  const api = new FakeExamApi();
  const [attempt, setAttempt] = useState<Awaited<ReturnType<FakeExamApi['startMock']>> | null>(null);
  useEffect(() => { void api.startMock().then(setAttempt); }, []);
  return attempt ? <MockRunningScreen api={api} attempt={attempt} onSubmitted={noop} /> : null;
}

describe.each(['light', 'dark'] as const)('axe: no serious or critical violations (%s)', theme => {
  beforeEach(() => {
    document.documentElement.lang = 'en';
    document.documentElement.setAttribute('data-theme', theme);
  });
  it.each(cases)('$name', async c => {
    setViewport(c.width ?? 360, theme === 'dark');
    const { container } = render(c.ui());
    await c.ready();
    await waitFor(() => expect(container.childElementCount).toBeGreaterThan(0));
    const found = await violations(document.body);
    expect(found, fmt(found)).toEqual([]);
  });
});
