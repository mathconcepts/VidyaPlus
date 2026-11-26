import { lazy, Suspense, useId, useState } from 'react';
import { TextField } from '@vidhya/ui/components/TextField';
import { handwritingEnabled } from '../features';
import { tryParseNat } from '@vidhya/shared/nat-input';

/** Reading of the typed text with the SAME parser the grader uses (E4, DR15). */
export function readsAs(raw: string): { state: 'empty' } | { state: 'ok'; text: string } | { state: 'bad'; hint: string } {
  if (raw.trim() === '') return { state: 'empty' };
  const r = tryParseNat(raw);
  if (!r.ok) return { state: 'bad', hint: r.hint };
  return { state: 'ok', text: String(r.value).replace('-', '−') };
}

// The pad, TF.js and the model load on the first tap of Write (T31, E11): not in the first-load budget.
const HandwritingPad = lazy(() => import('../handwriting/HandwritingPad'));

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'] as const;

export function pressKey(value: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'back') return value.slice(0, -1);
  if (key === '−') return value.startsWith('-') ? value.slice(1) : `-${value}`;
  if (key === '.') return value.includes('.') ? value : value === '' || value === '-' ? `${value}0.` : `${value}.`;
  return /^\d$/.test(key) && value.length < 16 ? value + key : value;
}

/**
 * NAT input (DR15): a GATE-style in-page keypad with 7-8-9 on top. The field is
 * inputmode="none", so a phone's system keyboard never opens; physical keys work
 * on a laptop. Only "." is a decimal point. "Reads as" shows what will be graded.
 */
export function NatEntry({ value, onChange, markingNote, showWrite = true, disabled = false }: {
  value: string;
  onChange: (v: string) => void;
  markingNote: string;
  /** Practice only: the mock is keypad-only, like GATE (DR15b). */
  showWrite?: boolean;
  disabled?: boolean;
}) {
  const readsId = useId();
  const [note, setNote] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const padId = useId();
  const canWrite = showWrite && handwritingEnabled();
  const reading = readsAs(value);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k.length > 1) return; // Backspace, arrows, Tab, Enter ...
    if (/^\d$/.test(k)) { setNote(null); return; }
    e.preventDefault();
    if (k === '.') { onChange(pressKey(value, '.')); setNote(null); return; }
    if (k === '-') { if (!value.startsWith('-')) onChange(pressKey(value, '−')); return; }
    if (k === ',') { setNote('Use a full stop (.) for the decimal point.'); return; }
  };

  const press = (k: string) => { if (!disabled) { setNote(null); onChange(pressKey(value, k)); } };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <TextField
            ariaLabel="Your answer"
            value={value}
            onChange={v => { setNote(null); onChange(v); }}
            inputMode="none"
            mono
            ring="ink"
            invalid={reading.state === 'bad'}
            describedBy={readsId}
            onKeyDown={onKeyDown}
          />
        </div>
        {canWrite && (
          <button
            type="button"
            className="write-toggle"
            aria-pressed={writing}
            aria-controls={writing ? padId : undefined}
            aria-label={writing ? 'Close handwriting pad' : 'Write your answer by hand'}
            disabled={disabled}
            onClick={() => setWriting(w => !w)}
          >Write</button>
        )}
      </div>
      <p id={readsId} aria-live="polite" style={{ fontSize: 'var(--text-subhead)', color: reading.state === 'bad' ? 'var(--red-ink)' : 'var(--text-secondary)', margin: '8px 2px 0' }}>
        {reading.state === 'ok' && <>Reads as <span className="mono">{reading.text}</span> · {markingNote}</>}
        {reading.state === 'empty' && <>{markingNote}</>}
        {reading.state === 'bad' && <>Doesn't read as a number yet · {reading.hint}</>}
        {note && <> {note}</>}
      </p>
      {canWrite && writing && !disabled && (
        <div id={padId} onKeyDown={e => { if (e.key === 'Escape') setWriting(false); }}>
          <Suspense fallback={<p role="status" className="hw-note">Loading handwriting reader…</p>}>
            <HandwritingPad onConfirm={text => { setNote(null); onChange(text); setWriting(false); }} />
          </Suspense>
        </div>
      )}
      <div className="keypad" role="group" aria-label="Number keypad">
        {KEYS.slice(0, 9).map(k => <button key={k} type="button" onClick={() => press(k)}>{k}</button>)}
        <button type="button" onClick={() => press('0')}>0</button>
        <button type="button" className="fn" aria-label="Decimal point" onClick={() => press('.')}>.</button>
        <button type="button" className="fn" aria-label="Minus" onClick={() => press('−')}>−</button>
        <button type="button" className="fn wide" onClick={() => press('clear')}>Clear</button>
        <button type="button" className="fn" aria-label="Backspace" onClick={() => press('back')}>⌫</button>
      </div>
    </div>
  );
}
