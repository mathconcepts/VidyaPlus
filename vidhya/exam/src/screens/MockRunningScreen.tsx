import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import type { Answer, ExamApi, MockAttempt, MockItemLite } from '../api/types';
import { formatClock, KIND_LABEL } from '../lib/format';
import { useMediaQuery, useServerCountdown } from '../lib/hooks';
import { NatEntry } from '../components/NatEntry';
import { OptionList, useMockShortcuts } from '../components/OptionList';
import { Palette, paletteCounts } from '../components/Palette';
import { ReportSheet } from '../components/ReportSheet';
import { TitleBar } from '../components/TitleBar';

const answerFrom = (item: MockItemLite, picked: string[], nat: string): Answer | null =>
  item.kind === 'nat' ? (nat.trim() ? { kind: 'nat', raw: nat } : null)
  : item.kind === 'msq' ? (picked.length ? { kind: 'msq', keys: picked } : null)
  : picked[0] ? { kind: 'mcq', key: picked[0] } : null;

interface Local { picked: string[]; nat: string; flagged: boolean }

/** What the timer region announces, and only at 30, 10 and 5 minutes left (DR17). */
export function announcement(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return 'Time is up';
  if (remainingSeconds <= 300) return '5 minutes left';
  if (remainingSeconds <= 600) return '10 minutes left';
  if (remainingSeconds <= 1800) return '30 minutes left';
  return '';
}

/**
 * The sitting (M2, M3, M4, M5). The timer is the SERVER's: `attempt.serverNowMs`
 * and `attempt.deadlineMs` come from the API and the device clock is never read.
 * Input locks at the deadline (E6). From 1024px the palette is a fixed right
 * panel and the shortcuts 1-4 / A-D, N, F show key hints (DR16).
 */
export function MockRunningScreen({ api, attempt, onSubmitted, waiting = 0, unscored = false, tutorHref }: {
  api: ExamApi;
  attempt: MockAttempt;
  onSubmitted: () => void;
  /** Answers queued offline (E3): the title bar shows "Offline · N answers waiting". */
  waiting?: number;
  unscored?: boolean;
  tutorHref?: string;
}) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const items = attempt.items;
  const [i, setI] = useState(0);
  const [local, setLocal] = useState<Record<string, Local>>(() =>
    Object.fromEntries(items.map(it => {
      const s = attempt.saved[it.id];
      const a = s?.answer;
      return [it.id, { picked: a?.kind === 'mcq' ? [a.key] : a?.kind === 'msq' ? a.keys : [], nat: a?.kind === 'nat' ? a.raw : '', flagged: s?.flagged ?? false }];
    })),
  );
  const [saved, setSaved] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const stemId = useId();

  const remaining = useServerCountdown(attempt.serverNowMs, attempt.deadlineMs);
  const locked = remaining <= 0;
  const expired = useRef(false);
  useEffect(() => {
    if (locked && !expired.current) { expired.current = true; void api.submitMock(attempt.attemptId).then(onSubmitted); }
  }, [locked, api, attempt.attemptId, onSubmitted]);

  const item = items[i];
  const st = local[item.id];
  const statuses = useMemo(() => items.map(it => ({ answered: !!answerFrom(it, local[it.id].picked, local[it.id].nat), flagged: local[it.id].flagged })), [items, local]);
  const counts = paletteCounts(statuses);

  const update = (patch: Partial<Local>) => {
    if (locked) return;
    const next = { ...st, ...patch };
    setLocal(l => ({ ...l, [item.id]: next }));
    setSaved(false);
    void api.answerMock(attempt.attemptId, item.id, answerFrom(item, next.picked, next.nat), next.flagged).then(() => setSaved(true));
  };

  const go = (n: number) => { setI(Math.max(0, Math.min(items.length - 1, n))); setSaved(false); setShowPalette(false); };
  const openConfirm = () => { setShowPalette(false); setConfirming(true); };
  const next = () => { if (i + 1 >= items.length) openConfirm(); else go(i + 1); };

  useMockShortcuts({
    enabled: !locked && !confirming,
    optionCount: item.options?.length ?? 0,
    onSelect: idx => {
      const o = item.options?.[idx];
      if (!o) return;
      update({ picked: item.kind === 'msq' ? (st.picked.includes(o.key) ? st.picked.filter(k => k !== o.key) : [...st.picked, o.key].sort()) : [o.key] });
    },
    onNext: next,
    onFlag: () => update({ flagged: !st.flagged }),
  });

  const rule = item.kind === 'mcq' ? '−⅓ for a wrong answer' : item.kind === 'msq' ? 'no partial credit, no negative marks' : 'no negative marks';
  const red = remaining < 600;
  const palette = (
    <>
      <p className="eyebrow">Questions</p>
      <Palette statuses={statuses} current={i} onGo={go} />
      <p className="eyebrow" style={{ margin: '16px 0' }}>answered {counts.answered} · blank {counts.blank} · flagged {counts.flagged}</p>
      <Button variant="grey" tone="neutral" size="lg" full onClick={openConfirm}>Submit mock</Button>
    </>
  );

  const unanswered = statuses.map((s, n) => (s.answered ? 0 : n + 1)).filter(Boolean);

  const body = confirming ? (
    <div className="col stack" role="region" aria-label="Submit the mock">
      <h2 className="headline" style={{ fontSize: 'var(--text-title2)' }}>Submit the mock?</h2>
      <p className="lede" style={{ margin: 0 }}>
        {unanswered.length === 0 ? 'Every question has an answer.' : <>Unanswered: <span className="mono">{unanswered.join(', ')}</span></>}
        {counts.flagged > 0 && <> · flagged <span className="mono">{counts.flagged}</span></>}
      </p>
      <div className="row-actions">
        <Button variant="grey" tone="neutral" size="lg" onClick={() => setConfirming(false)}>Keep going</Button>
        <Button tone="action" size="lg" onClick={() => void api.submitMock(attempt.attemptId).then(onSubmitted)}>Submit now</Button>
      </div>
    </div>
  ) : (
    <div className="col">
      <p className="eyebrow">{item.marks} mark{item.marks > 1 ? 's' : ''} · {KIND_LABEL[item.kind]}{item.kind === 'msq' ? ' · select all that apply' : ''}</p>
      <p id={stemId} className="stem" dangerouslySetInnerHTML={{ __html: item.stemHtml }} />
      {item.kind === 'nat' ? (
        <NatEntry value={st.nat} onChange={v => update({ nat: v })} showWrite={false} disabled={locked} markingNote="no negative marks · blank counts as skipped" />
      ) : (
        <OptionList kind={item.kind} options={item.options ?? []} selected={st.picked} onChange={keys => update({ picked: keys })} name={item.id} showHints={wide} disabled={locked} labelledBy={stemId} />
      )}
      <p role="status" style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-secondary)', margin: '12px 2px' }}>{saved ? 'Saved · ' : ''}{rule}</p>
      <div className="row-actions">
        <Button variant="grey" tone="neutral" size="lg" ariaKeyShortcuts="F" onClick={() => update({ flagged: !st.flagged })} disabled={locked}>
          {st.flagged ? 'Unflag' : 'Flag'}{wide && <span className="kbd" aria-hidden="true">F</span>}
        </Button>
        <Button tone="action" size="lg" ariaKeyShortcuts="N" onClick={next} style={{ flex: 2 }}>
          {i + 1 >= items.length ? 'Review and submit' : 'Next'}{wide && <span className="kbd" aria-hidden="true" style={{ color: 'inherit' }}>N</span>}
        </Button>
      </div>
      {reporting && (
        <div style={{ marginTop: 16 }}>
          <ReportSheet context="mock" onSend={note => api.report(item.id, note, 'mock')} onClose={() => setReporting(false)} />
        </div>
      )}
      {!wide && showPalette && <div style={{ marginTop: 20 }}>{palette}</div>}
    </div>
  );

  return (
    <div className="shell">
      <TitleBar
        tutorHref={tutorHref}
        left={<span className="mono" style={{ color: 'var(--text-secondary)' }}>{i + 1} of {items.length}</span>}
        center={
          <span className={`mono ${red ? 'timer-red' : ''}`} role="timer" aria-label="Time left" style={{ fontWeight: 600, fontSize: 'var(--text-body)' }}>
            {formatClock(remaining)}
          </span>
        }
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
            {waiting > 0 && <span style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-secondary)' }}>Offline · {waiting} answers waiting</span>}
            {!wide && <button type="button" className="linklike" aria-expanded={showPalette} onClick={() => setShowPalette(s => !s)}>Questions</button>}
            <button type="button" className="linklike" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>⋯</button>
            {menu && (
              <div role="menu" style={{ position: 'absolute', top: 52, right: 0, background: 'var(--surface-card)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-card)', padding: 4, whiteSpace: 'nowrap' }}>
                <button type="button" role="menuitem" className="linklike" style={{ padding: '0 12px', color: 'var(--text-primary)' }} onClick={() => { setMenu(false); setReporting(true); }}>⋯ Report a problem</button>
              </div>
            )}
          </span>
        }
      />
      <div role="status" aria-live="polite" className="sr-only">{announcement(remaining)}</div>
      {unscored && <p className="banner" style={{ marginBottom: 0 }}>Practice mock · unscored</p>}
      <div className={wide ? 'mock-wide' : ''}>
        <main className={`main ${wide ? 'has-palette' : ''}`} style={wide ? { display: 'flex', justifyContent: 'center' } : undefined}>{body}</main>
        {wide && <aside className="palette-panel" aria-label="Question palette">{palette}</aside>}
      </div>
    </div>
  );
}
