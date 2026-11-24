import { useState } from 'react';
import { ReceiptBorder } from '@vidhya/ui/components/ReceiptBorder';
import { receiptFromItemRecord, receiptFromRecheck } from '@vidhya/ui/lib/receipt';
import type { ExamItem, ItemVerification } from '../api/types';

/**
 * The five receipt states (DR9, T27). Verified (green) and verified-neutral
 * (inside a wrong answer) and pending (orange) go through ReceiptBorder, each
 * needing a real record. Withdrawn and locked have no receipt object, so they
 * are plain text on the sunken grey with no border.
 */
export function ReceiptState({ item, verification, wrong = false }: {
  item: Pick<ExamItem, 'id' | 'fingerprint'>;
  verification: ItemVerification;
  wrong?: boolean;
}) {
  const [open, setOpen] = useState(false);
  switch (verification.state) {
    case 'locked':
      return <p className="plain" style={{ margin: 0 }}>Receipt unlocks with the answers on {verification.unlockOn}.</p>;
    case 'withdrawn':
      return <p className="plain" style={{ margin: 0 }}>Withdrawn while we re-check. It won't count against you. <span className="mono">#{item.id}</span></p>;
    case 'rechecking': {
      const r = receiptFromRecheck({ status: 'rechecking', note: verification.note });
      return <ReceiptBorder receipt={r} tone="pending">{null}</ReceiptBorder>;
    }
    case 'verified': {
      const r = receiptFromItemRecord(
        { status: 'verified', source: verification.source, recordFingerprint: verification.recordFingerprint },
        item.fingerprint,
      );
      // Fingerprint mismatch: the receipt does not belong to this version of the item, so no border and no claim.
      if (!r) return <p className="plain" style={{ margin: 0 }}>This item is not verified yet.</p>;
      return (
        <ReceiptBorder receipt={r} tone={wrong ? 'neutral' : 'positive'}>
          <button
            type="button"
            className="linklike"
            style={{ minHeight: 48, color: 'var(--text-primary)', fontSize: 'var(--text-subhead)', textDecoration: 'underline' }}
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? 'Hide engine lines' : 'Show engine lines'}
          </button>
          {open && (
            <pre className="engine" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{verification.engineLines.join('\n')}</pre>
          )}
        </ReceiptBorder>
      );
    }
  }
}
