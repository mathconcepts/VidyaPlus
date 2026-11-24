import { useEffect, useState } from 'react';
import { EmptyState } from '@vidhya/ui/components/EmptyState';
import { ListRow } from '@vidhya/ui/components/ListRow';
import type { ExamApi, MarksView } from '../api/types';

/** Marks: one gauge that names its basis, then "Why marks are lost" including Unclassified, shown openly. */
export function MarksScreen({ api }: { api: ExamApi }) {
  const [m, setM] = useState<MarksView | null>(null);
  useEffect(() => { let live = true; api.getMarks().then(x => { if (live) setM(x); }); return () => { live = false; }; }, [api]);
  if (!m) return <div className="col" aria-busy="true" aria-label="Loading your marks"><div className="focal"><div className="skeleton" style={{ height: 34, width: '45%' }} /><div className="skeleton" style={{ height: 8, marginTop: 16 }} /></div></div>;
  if (!m.range) return <div className="col"><EmptyState title="Take the mock to see your marks range" /></div>;
  const { low, high, of } = m.range;
  return (
    <div className="col">
      <p className="eyebrow">Engineering Maths · {of} marks in GATE EC</p>
      <section className="focal" aria-label="Marks range">
        <div className="big">{low}–{high} <span style={{ fontSize: 'var(--text-title3)', color: 'var(--text-secondary)' }}>of {of}</span></div>
        <div className="range" role="img" aria-label={`${low} to ${high} out of ${of}`}>
          <span style={{ left: `${(low / of) * 100}%`, width: `${((high - low) / of) * 100}%` }} />
        </div>
        <div className="scale" aria-hidden="true"><span>0</span><span>{Math.round(of / 3)}</span><span>{Math.round((2 * of) / 3)}</span><span>{of}</span></div>
        <p className="basis" style={{ fontSize: 'var(--text-subhead)' }}>{m.basis}{m.lastWeek ? ` ${m.lastWeek}` : ''}</p>
      </section>
      <h2 className="label" style={{ fontWeight: 'var(--weight-regular)' }}>Why marks are lost</h2>
      <div>
        {m.lost.map((l, i) => (
          <ListRow key={l.label} padding="0 2px" title={l.label} trailing={<span className="mono" style={{ color: 'var(--text-secondary)' }}>{l.marks}</span>} last={i === m.lost.length - 1} />
        ))}
      </div>
    </div>
  );
}
