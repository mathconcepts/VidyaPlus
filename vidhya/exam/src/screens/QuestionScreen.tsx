import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import type { Answer, CheckResult, ExamApi, ExamItem, TodayItemRef } from '../api/types';
import { KIND_LABEL, markingChip } from '../lib/format';
import { useFocusOn } from '../lib/hooks';
import { NatEntry } from '../components/NatEntry';
import { OptionList } from '../components/OptionList';
import { ReceiptState } from '../components/ReceiptState';
import { ResultPanel } from '../components/ResultPanel';
import { TitleBar } from '../components/TitleBar';

/**
 * One practice item at a time: Question, then Result. Offline checks are saved
 * and shown as "Saved · we'll check it when you're back online" (DR5): Next stays
 * enabled and the result appears in place when the network returns.
 */
export function QuestionScreen({ api, items, startIndex = 0, onExit, onOffline, tutorHref }: {
  api: ExamApi;
  items: TodayItemRef[];
  startIndex?: number;
  onExit: () => void;
  /** Tells the shell to show / clear the offline banner. */
  onOffline: (offline: boolean) => void;
  tutorHref?: string;
}) {
  const [index, setIndex] = useState(startIndex);
  const [item, setItem] = useState<ExamItem | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [nat, setNat] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [phase, setPhase] = useState<'answering' | 'checking' | 'queued'>('answering');
  const [slow, setSlow] = useState(false);
  const stemId = useId();
  const focusRef = useFocusOn<HTMLHeadingElement>(result);
  const current = useRef<string>('');

  const ref = items[index];

  useEffect(() => {
    let live = true;
    setItem(null); setPicked([]); setNat(''); setResult(null); setPhase('answering'); setSlow(false);
    api.getItem(ref.id).then(i => { if (live) { current.current = i.id; setItem(i); } });
    return () => { live = false; };
  }, [api, ref.id]);

  // A queued answer's result arrives in place (DR5), and Today counts it then.
  useEffect(() => api.onQueuedResult(r => {
    onOffline(false);
    if (r.itemId === current.current) { setResult(r); setPhase('answering'); }
  }), [api, onOffline]);

  const answer: Answer | null = !item ? null
    : item.kind === 'nat' ? (nat.trim() ? { kind: 'nat', raw: nat } : null)
    : item.kind === 'msq' ? (picked.length ? { kind: 'msq', keys: picked } : null)
    : picked[0] ? { kind: 'mcq', key: picked[0] } : null;

  const check = useCallback(async () => {
    if (!item || !answer) return;
    setPhase('checking');
    const t = setTimeout(() => setSlow(true), 2500);
    try {
      const out = await api.checkAnswer(item.id, answer);
      if (out.status === 'queued') { setPhase('queued'); onOffline(true); }
      else { setResult(out.result); setPhase('answering'); }
    } finally { clearTimeout(t); setSlow(false); }
  }, [api, item, answer, onOffline]);

  const next = () => { if (index + 1 >= items.length) onExit(); else setIndex(index + 1); };

  const chip = item ? markingChip(item.marks, item.negative) : '';
  const lastLabel = index + 1 >= items.length ? 'Done' : 'Next';

  const resultClass: Record<string, string> | undefined = result && item?.options
    ? Object.fromEntries([
        ...result.key.split(',').map(k => [k, 'right'] as const),
        ...(result.outcome === 'wrong' ? result.yours.split(',').filter(k => !result.key.split(',').includes(k)).map(k => [k, 'wrong'] as const) : []),
      ])
    : undefined;

  return (
    <div className="shell">
      <TitleBar
        left={<button type="button" className="linklike" aria-label="Close and go back to Today" onClick={onExit}>✕</button>}
        center={<span className="mono" style={{ color: 'var(--text-secondary)' }}>{index + 1} of {items.length}</span>}
        right={<span className="mono" style={{ color: 'var(--text-secondary)' }}>{chip}</span>}
      />
      <main className="main">
        <div className="col">
          {!item ? (
            <div aria-busy="true" aria-label="Loading the question"><div className="skeleton" style={{ height: 24, width: '40%' }} /><div className="skeleton" style={{ height: 80, marginTop: 16 }} /></div>
          ) : item.verification.state === 'withdrawn' ? (
            <div className="stack">
              <p className="eyebrow">{item.topicLabel}</p>
              <ReceiptState item={item} verification={item.verification} />
              <Button tone="action" size="lg" full onClick={next}>{lastLabel}</Button>
            </div>
          ) : (
            <>
              <p className="eyebrow">{item.topicLabel} · {item.marks} mark{item.marks > 1 ? 's' : ''} · {KIND_LABEL[item.kind]}</p>
              <p id={stemId} className="stem" dangerouslySetInnerHTML={{ __html: item.stemHtml }} />
              {item.kind === 'nat' ? (
                <NatEntry value={nat} onChange={setNat} disabled={!!result} markingNote="no negative marks · blank counts as skipped" />
              ) : (
                <OptionList
                  kind={item.kind}
                  options={item.options ?? []}
                  selected={result ? result.yours.split(',').filter(Boolean) : picked}
                  onChange={setPicked}
                  name={item.id}
                  disabled={!!result || phase !== 'answering'}
                  resultClass={resultClass}
                  labelledBy={stemId}
                />
              )}
              {item.kind === 'msq' && !result && <p className="eyebrow" style={{ marginTop: 8 }}>Select all that apply</p>}

              {!result && (
                <div style={{ marginTop: 20 }}>
                  {phase === 'queued' ? (
                    <div className="stack">
                      <p className="plain" role="status" style={{ margin: 0 }}>Saved · we'll check it when you're back online</p>
                      <Button tone="action" size="lg" full onClick={next}>{lastLabel}</Button>
                    </div>
                  ) : (
                    <>
                      <Button tone="action" size="lg" full disabled={!answer || phase === 'checking'} onClick={check}>Check</Button>
                      {phase === 'checking' && (
                        <p role="status" style={{ margin: '8px 2px 0', color: 'var(--text-secondary)', fontSize: 'var(--text-subhead)' }}>
                          {slow ? 'Still checking. Your answer is saved.' : 'Checking…'}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {result && (
                <ResultPanel
                  item={item}
                  result={result}
                  focusRef={focusRef}
                  nextLabel={lastLabel}
                  onNext={next}
                  tutorHref={tutorHref}
                  onReport={note => api.report(item.id, note, 'item')}
                />
              )}
              <p style={{ textAlign: 'center', fontSize: 'var(--text-subhead)', color: 'var(--text-secondary)', marginTop: 16 }}>
                {item.verification.state === 'verified' ? 'Verified set · ' : ''}<span className="mono">#{item.id}</span>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
