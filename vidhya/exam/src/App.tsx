import { useCallback, useEffect, useState } from 'react';
import { TabBar } from '@vidhya/ui/components/TabBar';
import { SegmentedControl } from '@vidhya/ui/components/SegmentedControl';
import type { ExamApi, MockAttempt, MockBrief, TodayItemRef } from './api/types';
import { BannerSlot, type Banner } from './components/BannerSlot';
import { TitleBar, TUTOR_HREF } from './components/TitleBar';
import { useMediaQuery } from './lib/hooks';
import { MarksScreen } from './screens/MarksScreen';
import { MockBriefScreen } from './screens/MockBriefScreen';
import { MockResultScreen } from './screens/MockResultScreen';
import { MockReviewScreen } from './screens/MockReviewScreen';
import { MockRunningScreen } from './screens/MockRunningScreen';
import { PractiseScreen } from './screens/PractiseScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { TodayScreen } from './screens/TodayScreen';

type Tab = 'today' | 'mock' | 'marks';
const TABS = [
  { value: 'today', label: 'Today' },
  { value: 'mock', label: 'Mock' },
  { value: 'marks', label: 'Marks' },
];
const TITLES: Record<Tab, string> = { today: 'Today', mock: 'Mock', marks: 'Marks' };

export interface AppProps {
  api: ExamApi;
  /** R23 `entitled_until` in the past (DR7). Marks and Review stay readable; Today and new items lock. */
  access?: { endedOn: string; renewHref: string };
  /** The API reported a newer build id (E10). */
  releaseAvailable?: boolean;
  tutorHref?: string;
}

type Session =
  | { kind: 'none' }
  | { kind: 'practise' }
  | { kind: 'questions'; items: TodayItemRef[] }
  | { kind: 'mock-running'; attempt: MockAttempt; unscored: boolean }
  | { kind: 'mock-result'; attemptId: string; unscored: boolean };

export function App({ api, access, releaseAvailable = false, tutorHref = TUTOR_HREF }: AppProps) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [tab, setTab] = useState<Tab>('today');
  const [session, setSession] = useState<Session>({ kind: 'none' });
  const [offline, setOffline] = useState(false);
  const [outage, setOutage] = useState(false);
  const [brief, setBrief] = useState<MockBrief | null>(null);

  useEffect(() => { let live = true; api.getMockBrief().then(b => { if (live) setBrief(b); }).catch(() => { if (live) setOutage(true); }); return () => { live = false; }; }, [api, session.kind]);

  const banner: Banner | null = outage ? { kind: 'outage', tutorHref }
    : access ? { kind: 'access-ended', endedOn: access.endedOn, renewHref: access.renewHref }
    : releaseAvailable ? { kind: 'release', onRefresh: () => window.location.reload() }
    : offline ? { kind: 'offline' }
    : null;

  const onOffline = useCallback((o: boolean) => setOffline(o), []);
  const locked = !!access;
  const endSession = () => { setSession({ kind: 'none' }); setOffline(false); };

  // Full-screen flows: no tab bar (one job per screen).
  if (session.kind === 'questions') {
    return (
      <>
        <QuestionScreen api={api} items={session.items} onExit={endSession} onOffline={onOffline} tutorHref={tutorHref} />
        {banner && <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}><BannerSlot banner={banner} /></div>}
      </>
    );
  }
  if (session.kind === 'mock-running') {
    return <MockRunningScreen api={api} attempt={session.attempt} unscored={session.unscored} tutorHref={tutorHref} onSubmitted={() => setSession({ kind: 'mock-result', attemptId: session.attempt.attemptId, unscored: session.unscored })} />;
  }

  const startMock = async (unscored: boolean) => setSession({ kind: 'mock-running', attempt: await api.startMock(), unscored });

  let content;
  if (session.kind === 'mock-result') {
    content = <MockResultScreen api={api} attemptId={session.attemptId} unscored={session.unscored} onBack={() => { setSession({ kind: 'none' }); setTab('today'); }} />;
  } else if (session.kind === 'practise') {
    content = <PractiseScreen api={api} onBack={endSession} onOpen={items => setSession({ kind: 'questions', items })} />;
  } else if (tab === 'today') {
    content = (
      <TodayScreen
        api={api}
        locked={locked}
        mockPhase={brief?.phase}
        onStart={plan => setSession({ kind: 'questions', items: plan.items })}
        onContinue={() => setSession({ kind: 'practise' })}
        onPractise={() => setSession({ kind: 'practise' })}
      />
    );
  } else if (tab === 'mock') {
    content = brief?.phase === 'closed' && brief.taken === 'submitted'
      ? <MockReviewScreen api={api} />
      : <MockBriefScreen api={api} brief={brief ?? undefined} locked={locked} onStart={startMock} />;
  } else {
    content = <MarksScreen api={api} />;
  }

  const tabLabel = tab === 'mock' && brief?.phase === 'closed' && brief.taken === 'submitted' ? 'Review' : TITLES[tab];
  const options = TABS.map(t => (t.value === 'mock' && brief?.phase === 'closed' && brief.taken === 'submitted' ? { ...t, label: 'Review' } : t));

  return (
    <div className="shell">
      <TitleBar
        tutorHref={tutorHref}
        title={wide ? undefined : tabLabel}
        center={wide ? <SegmentedControl options={options} value={tab} size="lg" ariaLabel="Exam sections" onChange={v => { setSession({ kind: 'none' }); setTab(v as Tab); }} /> : undefined}
      />
      <BannerSlot banner={banner} />
      <main className="main">{content}</main>
      {!wide && (
        <div className="tabbar-wrap">
          <TabBar items={options} value={tab} ariaLabel="Exam sections" activeTone="ink" onChange={v => { setSession({ kind: 'none' }); setTab(v as Tab); }} />
        </div>
      )}
    </div>
  );
}
