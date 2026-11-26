import { useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import type { CheckResult, ExamItem } from '../api/types';
import { winLine } from '../lib/format';
import { reasonProps } from '../lib/reason';
import { ReceiptState } from './ReceiptState';
import { ReportSheet } from './ReportSheet';
import { TUTOR_HREF } from './TitleBar';

/**
 * Result (section 21): answer rows, the counted win line (DR12), a one-line
 * reason, the receipt (tone by state), Next, then "Ask the tutor why" and
 * "Report wrong key". Focus lands on the result line (DR17).
 */
export function ResultPanel({ item, result, onNext, nextLabel = 'Next', focusRef, onReport, tutorHref = TUTOR_HREF }: {
  item: ExamItem;
  result: CheckResult;
  onNext: () => void;
  nextLabel?: string;
  focusRef: React.RefObject<HTMLHeadingElement>;
  onReport: (note: string) => Promise<void> | void;
  tutorHref?: string;
}) {
  const [reporting, setReporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrong = result.outcome === 'wrong';
  const headline =
    result.outcome === 'correct' && result.week ? winLine(result.week)
    : result.outcome === 'correct' ? 'Right.'
    : result.outcome === 'wrong' ? 'Not this time.'
    : 'Skipped.';

  // DR10 / T34: pre-fill needs a W0 check of DeepTutor chat. Until then the link also copies "Explain #id" to the clipboard.
  const ask = () => {
    void navigator.clipboard?.writeText(`Explain #${item.id}`).then(() => setCopied(true), () => {});
  };

  return (
    <section aria-label="Result" className="stack" style={{ marginTop: 14 }}>
      <h2 ref={focusRef} tabIndex={-1} style={{ margin: 0, fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', outline: 'none' }}>
        {headline}
      </h2>
      <p style={{ margin: 0, fontSize: 'var(--text-body)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Yours </span><span className="mono">{result.yours || 'blank'}</span>
        <span style={{ color: 'var(--text-secondary)' }}> · Key </span><span className="mono">{result.key}</span>
      </p>
      <p style={{ margin: 0, fontSize: 'var(--text-body)', lineHeight: 'var(--leading-normal)' }} {...reasonProps(result)} />
      <ReceiptState item={item} verification={result.verification} wrong={wrong} />
      <Button tone="action" size="lg" full onClick={onNext}>{nextLabel}</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-body)' }}>
        {!item.inMock ? (
          <a
            href={`${tutorHref}chat?prefill=${encodeURIComponent(`Explain #${item.id}`)}`}
            onClick={ask}
            style={{ color: 'var(--indigo-ink)', minHeight: 48, display: 'inline-flex', alignItems: 'center' }}
          >
            Ask the tutor why
          </a>
        ) : <span />}
        <button type="button" className="linklike" onClick={() => setReporting(r => !r)}>Report wrong key</button>
      </div>
      {copied && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>Copied, paste to ask</p>}
      {reporting && <ReportSheet context="item" onSend={onReport} onClose={() => setReporting(false)} />}
    </section>
  );
}
