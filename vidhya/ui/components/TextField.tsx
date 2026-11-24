import { useState, type ReactNode } from 'react';

export interface TextFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  hint?: string;
  invalid?: boolean;
  leading?: ReactNode;
  /** Virtual-keyboard hint. 'none' keeps the system keyboard closed (the NAT keypad owns input). */
  inputMode?: 'none' | 'text' | 'decimal' | 'numeric';
  /** id of the element that describes the field (a hint or a 'Reads as' line). */
  describedBy?: string;
  /** Monospace, larger text for computed values such as a numerical answer. */
  mono?: boolean;
  onKeyDown?: (e: import('react').KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
  /** Focus ring colour. 'ink' for /exam, where indigo is reserved for the tutor (DR13). */
  ring?: 'indigo' | 'ink';
}

export function TextField({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  hint,
  invalid = false,
  leading,
  inputMode,
  describedBy,
  mono = false,
  onKeyDown,
  ariaLabel,
  ring = 'indigo',
}: TextFieldProps) {
  const [focus, setFocus] = useState(false);
  return (
    <label style={{ display: 'block', fontFamily: 'var(--font-sans)' }}>
      {label && (
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-footnote)',
            color: 'var(--text-secondary)',
            marginBottom: 6,
          }}
        >
          {label}
        </span>
      )}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: mono ? 56 : 44,
          padding: '0 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-fill)',
          boxShadow: invalid
            ? 'inset 0 0 0 2px var(--red)'
            : focus
            ? `inset 0 0 0 2px var(--${ring === 'ink' ? 'ink' : 'indigo'})`
            : 'none',
          transition: 'box-shadow var(--dur-fast) var(--ease-standard)',
        }}
      >
        {leading}
        <input
          type={type}
          inputMode={inputMode}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange?.(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: mono ? 'var(--text-title1)' : 'var(--text-callout)',
            fontFamily: mono ? 'var(--font-mono)' : 'inherit',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
          }}
        />
      </span>
      {hint && (
        <span
          style={{
            display: 'block',
            marginTop: 6,
            fontSize: 'var(--text-caption)',
            color: invalid ? 'var(--red-ink)' : 'var(--text-secondary)',
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}
