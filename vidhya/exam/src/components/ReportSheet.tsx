import { useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import type { ReportContext } from '../api/types';

/** "Report a problem" with one optional note (DR18). No modal: an inline sheet. */
export function ReportSheet({ context, onSend, onClose }: {
  context: ReportContext;
  onSend: (note: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="plain" role="status">
        {context === 'mock' ? 'Sent. We review mock reports after the close date. Answer as best you can.' : 'Sent. Thank you, we will look at it.'}
        <div style={{ marginTop: 8 }}><Button variant="grey" tone="neutral" size="lg" onClick={onClose}>Close</Button></div>
      </div>
    );
  }
  return (
    <form
      className="plain"
      aria-label="Report a problem"
      onSubmit={async e => { e.preventDefault(); await onSend(note.trim()); setSent(true); }}
    >
      <label style={{ display: 'block', color: 'var(--text-primary)' }}>
        Report a problem (optional note)
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          style={{ display: 'block', width: '100%', marginTop: 8, font: 'inherit', fontSize: 'var(--text-body)', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--separator)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
        />
      </label>
      <div className="row-actions">
        <Button variant="grey" tone="neutral" size="lg" onClick={onClose}>Cancel</Button>
        <Button tone="action" size="lg" type="submit">Send</Button>
      </div>
    </form>
  );
}
