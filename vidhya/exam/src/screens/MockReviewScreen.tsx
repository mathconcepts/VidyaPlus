import { useEffect, useState } from 'react';
import type { ExamApi, MockReviewRow } from '../api/types';
import { ReceiptState } from '../components/ReceiptState';

/** After close, for takers (DR6): each item with key, solution and receipt. */
export function MockReviewScreen({ api }: { api: ExamApi }) {
  const [rows, setRows] = useState<MockReviewRow[] | null>(null);
  useEffect(() => { let live = true; api.getMockReview().then(x => { if (live) setRows(x); }); return () => { live = false; }; }, [api]);
  if (!rows) return <div className="col" aria-busy="true"><div className="skeleton" style={{ height: 160 }} /></div>;
  return (
    <div className="col">
      <p className="eyebrow">Review · answers and receipts</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
        {rows.map(({ item, result }, i) => (
          <li key={item.id}>
            <h3 style={{ margin: '0 0 6px', fontSize: 'var(--text-body)' }}>{i + 1}. <span dangerouslySetInnerHTML={{ __html: item.stemHtml }} /></h3>
            <p style={{ margin: '0 0 6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Yours </span><span className="mono">{result.yours || 'blank'}</span>
              <span style={{ color: 'var(--text-secondary)' }}> · Key </span><span className="mono">{result.key}</span>
            </p>
            <p style={{ margin: '0 0 8px' }}>{result.reason}</p>
            <ReceiptState item={item} verification={result.verification} wrong={result.outcome === 'wrong'} />
          </li>
        ))}
      </ol>
    </div>
  );
}
