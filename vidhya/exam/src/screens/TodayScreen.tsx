import { useEffect, useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import { ListRow } from '@vidhya/ui/components/ListRow';
import { EmptyState } from '@vidhya/ui/components/EmptyState';
import type { ExamApi, MockPhase, TodayPlan } from '../api/types';
import { plannedHeadline } from '../lib/format';

/**
 * Today (DR3, DR4): one focal card, one line about the mock, and two rows at
 * most (Continue, Practise a topic). Both headline states are built here.
 */
export function TodayScreen({ api, onStart, onPractise, onContinue, locked = false, mockPhase = 'before-open' }: {
  api: ExamApi;
  onStart: (plan: TodayPlan) => void;
  onPractise: () => void;
  onContinue: () => void;
  /** Access ended (DR7): Today and new items are locked. */
  locked?: boolean;
  mockPhase?: MockPhase;
}) {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  useEffect(() => { let live = true; api.getToday().then(p => { if (live) setPlan(p); }); return () => { live = false; }; }, [api]);

  if (!plan) {
    return (
      <div className="col" aria-busy="true" aria-label="Loading today's plan">
        <div className="focal"><div className="skeleton" style={{ height: 14, width: '55%' }} /><div className="skeleton" style={{ height: 32, width: '85%', marginTop: 14 }} /><div className="skeleton" style={{ height: 14, width: '70%', marginTop: 14 }} /></div>
      </div>
    );
  }

  const { headline, basisTail } = plannedHeadline(plan);
  const eyebrow = `${plan.estimate ? "Today's plan" : 'Starter plan'} · ${plan.minutes} min · ${plan.items.length} items`;

  return (
    <div className="col">
      {plan.cleared ? (
        <EmptyState
          title={mockPhase === 'closed' ? 'You’ve cleared today’s best items.' : 'You’ve cleared today’s best items. Take the mock'}
          action={<Button tone="action" size="lg" onClick={onPractise}>Practise a topic</Button>}
        />
      ) : (
        <section className="focal" aria-labelledby="today-headline">
          <p className="eyebrow" style={{ marginBottom: 2 }}>{eyebrow}</p>
          <h2 id="today-headline" className="headline">{headline}</h2>
          <p className="basis">{plan.topics.join(', ')} · {basisTail}</p>
          {plan.withdrawnCount > 0 && (
            <p className="basis" role="status">{plan.withdrawnCount} item{plan.withdrawnCount === 1 ? '' : 's'} withdrawn while we re-check</p>
          )}
          {locked ? (
            <p className="plain" style={{ marginTop: 16 }}>New items are locked. Your marks history is still here.</p>
          ) : (
            <div style={{ marginTop: 16 }}><Button tone="action" size="lg" full onClick={() => onStart(plan)}>Start</Button></div>
          )}
        </section>
      )}
      <p className="eyebrow" style={{ margin: '14px 4px 0' }}>{plan.mockLine}</p>
      {!locked && (
        <>
          <p className="label">Pick up</p>
          <div>
            {plan.continueRow && (
              <ListRow
                padding="0 2px"
                title={plan.continueRow.label}
                trailing={<span className="mono" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-subhead)' }}>{plan.continueRow.progress}</span>}
                onClick={onContinue}
              />
            )}
            <ListRow padding="0 2px" title="Practise a topic" chevron last onClick={onPractise} />
          </div>
        </>
      )}
    </div>
  );
}
