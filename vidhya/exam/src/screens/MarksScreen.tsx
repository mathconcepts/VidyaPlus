import { useEffect, useState } from 'react';
import { EmptyState } from '@vidhya/ui/components/EmptyState';
import { ListRow } from '@vidhya/ui/components/ListRow';
import type { ExamApi, MarksView } from '../api/types';

/** Marks: one gauge that names its basis, then "Why marks are lost" including Unclassified, shown openly. */
export function MarksScreen({ api }: { api: ExamApi }) {
  const [m, setM] = useState<MarksView | null>(null);
  useEffect(() => { let live = true; api.getMarks().then(x => { if (live) setM(x); }); return () => { live = false; }; }, [api]);
  if (!m) return <div className="col" aria-busy="true" aria-label="Loading your marks"><div className="focal"><div className="skeleton" style={{ height: 34, width: '45%' }} /><div className="skeleton" style={{ height: 8, marginTop: 16 }} /></div></div>;
  if (!m.range) {
    // The brain's needs-more sentence ("Take the mock to see your marks range.") is the title; no number is shown.
    const title = m.status === 'needs_more' && m.basis ? m.basis.replace(/\.$/, '') : 'Take the mock to see your marks range';
    return <div className="col"><EmptyState title={title} /></div>;
  }
  const { low, high, of } = m.range;
  const rows = m.taxonomy
    ? m.taxonomy.map(t => ({ label: t.label, trailing: `${t.wrong} wrong` }))
    : m.lost.map(l => ({ label: l.label, trailing: String(l.marks) }));
  return (
    <div className="col">
      <p className="eyebrow">Engineering Maths · {of} marks in GATE EC</p>
      <section className="focal" aria-label="Marks range">
        <div className="big">{low}–{high} <span style={{ fontSize: 'var(--text-title3)', color: 'var(--text-secondary)' }}>of {of}</span></div>
        <div className="range" role="img" aria-label={`${low} to ${high} out of ${of}`}>
          <span style={{ left: `${(low / of) * 100}%`, width: `${((high - low) / of) * 100}%` }} />
        </div>
        <div className="scale" aria-hidden="true"><span>0</span><span>{Math.round(of / 3)}</span><span>{Math.round((2 * of) / 3)}</span><span>{of}</span></div>
        <p className="basis" style={{ fontSize: 'var(--text-subhead)' }}>{m.basis}{m.lowN ? ' (few attempts so far, so the range is wide)' : ''}{m.lastWeek ? ` ${m.lastWeek}` : ''}</p>
        {m.score && <p className="basis" style={{ fontSize: 'var(--text-subhead)' }}>Mock score {m.score.score} of {m.score.outOf} ({m.score.label})</p>}
      </section>
      <h2 className="label" style={{ fontWeight: 'var(--weight-regular)' }}>Why marks are lost</h2>
      <div>
        {rows.length === 0 && <p className="basis" style={{ fontSize: 'var(--text-subhead)' }}>No wrong answers to explain yet.</p>}
        {rows.map((r, i) => (
          <ListRow key={r.label} padding="0 2px" title={r.label} trailing={<span className="mono" style={{ color: 'var(--text-secondary)' }}>{r.trailing}</span>} last={i === rows.length - 1} />
        ))}
      </div>
    </div>
  );
}
