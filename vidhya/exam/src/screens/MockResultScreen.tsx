import { useEffect, useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import type { ExamApi, MockResultPreClose } from '../api/types';

/**
 * Mock result BEFORE close (DR11): the score, the right/wrong/skipped tally,
 * the "unproctored practice mock" label, the unlock date and one button.
 * No topic rows, no keys: the small form would leak them (T29).
 */
export function MockResultScreen({ api, attemptId, onBack, unscored = false }: { api: ExamApi; attemptId: string; onBack: () => void; unscored?: boolean }) {
  const [r, setR] = useState<MockResultPreClose | null>(null);
  useEffect(() => { let live = true; api.getMockResult(attemptId).then(x => { if (live) setR(x); }); return () => { live = false; }; }, [api, attemptId]);
  if (!r) return <div className="col" aria-busy="true"><div className="skeleton" style={{ height: 160 }} /></div>;
  return (
    <div className="col">
      <p className="eyebrow">{unscored ? 'Practice mock · unscored' : `Unproctored practice mock · submitted ${r.submittedOn}`}</p>
      <section className="focal" aria-label="Mock result">
        <div className="big mono">{r.score.toFixed(2)} <span style={{ fontSize: 'var(--text-title3)', color: 'var(--text-secondary)' }}>/ {r.outOf}</span></div>
        <p className="basis"><span className="mono">{r.right}</span> right · <span className="mono">{r.wrong}</span> wrong · <span className="mono">{r.skipped}</span> skipped</p>
        {!unscored && (
          <p className="plain" style={{ marginTop: 14 }}>
            Topic breakdown, answers, solutions and receipts unlock for everyone on <b>{r.unlockOn}</b>. Your score won't change.
          </p>
        )}
        <div style={{ marginTop: 16 }}><Button tone="action" size="lg" full onClick={onBack}>Back to today's plan</Button></div>
      </section>
    </div>
  );
}
