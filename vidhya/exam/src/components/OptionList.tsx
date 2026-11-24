import { useEffect, useRef } from 'react';
import type { ItemOption } from '../api/types';

/**
 * MCQ = radiogroup, MSQ = checkbox group (DR17). Selection is ink: a 2px inset
 * ring, a sunken fill and a filled glyph (DR13); the styling lives in exam.css
 * and keys off aria-checked. Options are 52px rows.
 */
export function OptionList({
  kind, options, selected, onChange, name, showHints = false, disabled = false, resultClass, labelledBy,
}: {
  kind: 'mcq' | 'msq';
  options: ItemOption[];
  selected: string[];
  onChange: (keys: string[]) => void;
  name: string;
  showHints?: boolean;
  disabled?: boolean;
  /** Per-key class after Check ('right' | 'wrong'). */
  resultClass?: Record<string, string>;
  labelledBy?: string;
}) {
  const toggle = (key: string) => {
    if (disabled) return;
    if (kind === 'mcq') onChange([key]);
    else onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key].sort());
  };
  // Roving tabindex for the radiogroup: arrow keys move and select.
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (kind !== 'mcq' || disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next = options[(i + d + options.length) % options.length];
      onChange([next.key]);
      (e.currentTarget.parentElement?.querySelectorAll('button')[(i + d + options.length) % options.length] as HTMLElement | undefined)?.focus();
    }
  };
  const first = selected[0] ?? options[0]?.key;
  return (
    <div role={kind === 'mcq' ? 'radiogroup' : 'group'} aria-labelledby={labelledBy} data-name={name}>
      {options.map((o, i) => {
        const on = selected.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            role={kind === 'mcq' ? 'radio' : 'checkbox'}
            aria-checked={on}
            aria-keyshortcuts={`${i + 1} ${o.key}`}
            tabIndex={kind === 'mcq' ? (o.key === first ? 0 : -1) : 0}
            aria-disabled={disabled || undefined}
            className={`opt ${resultClass?.[o.key] ?? ''}`}
            onClick={() => toggle(o.key)}
            onKeyDown={e => onKey(e, i)}
          >
            <span className={`g ${kind === 'msq' ? 'sq' : ''}`} aria-hidden="true" />
            <span className="k" aria-hidden="true">{o.key}</span>
            <span dangerouslySetInnerHTML={{ __html: o.html }} />
            {showHints && <span className="kbd" aria-hidden="true">{i + 1}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Mock shortcuts (DR16): 1-4 or A-D select, N next, F flag. Ignored while typing in a field. */
export function useMockShortcuts(h: { onSelect?: (index: number) => void; onNext: () => void; onFlag: () => void; enabled: boolean; optionCount: number }) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    if (!h.enabled) return;
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cur = ref.current;
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); cur.onNext(); return; }
      if (k === 'f') { e.preventDefault(); cur.onFlag(); return; }
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : /^[a-d]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
      if (idx >= 0 && idx < cur.optionCount) { e.preventDefault(); cur.onSelect?.(idx); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [h.enabled]);
}
