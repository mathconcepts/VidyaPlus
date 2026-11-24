import { useEffect, useState } from 'react';
import { ListRow } from '@vidhya/ui/components/ListRow';
import { EmptyState } from '@vidhya/ui/components/EmptyState';
import type { ExamApi, TodayItemRef, TopicRow } from '../api/types';

/** "Practise a topic": NAT practice by topic. A topic with no NAT items says so and points to the nearest one. */
export function PractiseScreen({ api, onOpen, onBack }: { api: ExamApi; onOpen: (items: TodayItemRef[]) => void; onBack: () => void }) {
  const [topics, setTopics] = useState<TopicRow[] | null>(null);
  const [empty, setEmpty] = useState<TopicRow | null>(null);
  useEffect(() => { let live = true; api.listTopics().then(t => { if (live) setTopics(t); }); return () => { live = false; }; }, [api]);
  if (!topics) return <div className="col" aria-busy="true"><div className="skeleton" style={{ height: 120 }} /></div>;
  const nearest = empty ? topics.find(t => t.natCount > 0) : null;
  return (
    <div className="col">
      <button type="button" className="linklike" onClick={onBack}>← Today</button>
      <h2 className="headline" style={{ margin: '8px 0 12px' }}>Practise a topic</h2>
      <div>
        {topics.map((t, i) => (
          <ListRow
            key={t.id}
            padding="0 2px"
            title={t.label}
            trailing={<span className="mono" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-subhead)' }}>{t.natCount} NAT</span>}
            chevron
            last={i === topics.length - 1}
            onClick={async () => {
              const items = await api.topicItems(t.id);
              if (items.length === 0) setEmpty(t); else { setEmpty(null); onOpen(items); }
            }}
          />
        ))}
      </div>
      {empty && (
        <div role="status">
          <EmptyState
            title={`No NAT items in ${empty.label} yet`}
            action={nearest ? <button type="button" className="linklike" style={{ textDecoration: 'underline' }} onClick={async () => onOpen(await api.topicItems(nearest.id))}>Try {nearest.label}</button> : undefined}
          />
        </div>
      )}
    </div>
  );
}
