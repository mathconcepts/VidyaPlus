import { useEffect, useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import { EmptyState } from '@vidhya/ui/components/EmptyState';
import type { ExamApi, MockBrief } from '../api/types';

/**
 * Mock tab entry. Before open: "Opens <date>". Open: the brief (two numbers and
 * four rules read from the form). After close: takers go to Review (DR6, handled
 * by the shell); non-takers get "Practice mock · unscored".
 */
export function MockBriefScreen({ api, onStart, locked = false, brief: given }: {
  api: ExamApi;
  onStart: (unscored: boolean) => void;
  locked?: boolean;
  brief?: MockBrief;
}) {
  const [brief, setBrief] = useState<MockBrief | null>(given ?? null);
  useEffect(() => { if (given) return; let live = true; api.getMockBrief().then(b => { if (live) setBrief(b); }); return () => { live = false; }; }, [api, given]);
  if (!brief) return <div className="col" aria-busy="true"><div className="skeleton" style={{ height: 160 }} /></div>;

  if (brief.phase === 'before-open') {
    return <div className="col"><EmptyState title={`Opens ${brief.opensOn}`} body="The mock is one sitting, timed at GATE pace." /></div>;
  }
  const unscored = brief.phase === 'closed';
  const canStart = brief.taken === 'in-progress' || !locked;
  const rules = unscored
    ? ['Timed at GATE pace', 'Answers shown at the end', 'Kept out of your marks range', 'MCQ −⅓ · MSQ and NAT no negative marks']
    : brief.rules;
  return (
    <div className="col">
      <p className="eyebrow">{unscored ? 'Practice mock · unscored' : 'Engineering Maths · GATE EC pattern'}</p>
      <div style={{ display: 'flex', gap: 28, margin: '6px 0 14px' }}>
        <div><div className="big mono">{brief.minutes}</div><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-subhead)' }}>minutes</p></div>
        <div><div className="big mono">{brief.questions}</div><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-subhead)' }}>questions · {brief.totalMarks} marks</p></div>
      </div>
      <p className="lede">
        {unscored
          ? 'The close date has passed, so this attempt is unscored. Use it to practise the pace.'
          : 'Timed at GATE pace. The score is an unproctored practice mock, so treat it as a guide, not a rank.'}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rules.map(r => <li key={r} className="rulerow">{r}</li>)}
      </ul>
      <div style={{ marginTop: 16 }}>
        {canStart ? (
          <Button tone="action" size="lg" full onClick={() => onStart(unscored)}>{brief.taken === 'in-progress' ? 'Resume mock' : unscored ? 'Start practice mock' : 'Start mock'}</Button>
        ) : (
          <p className="plain">New mocks are locked. Your marks history is still here.</p>
        )}
      </div>
    </div>
  );
}
