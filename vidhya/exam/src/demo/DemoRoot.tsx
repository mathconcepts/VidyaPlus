import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Root } from '../Root';
import { applyTheme, initTheme } from '../theme';
import { DemoExamApi } from './DemoApi';
import { configToHash, DEFAULTS, MARKS_LABELS, MOCK_LABELS, parseConfig, TODAY_LABELS, type DemoConfig } from './config';
import './demo.css';

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="demo-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value as T)}>
        {(Object.keys(options) as T[]).map(k => <option key={k} value={k}>{options[k]}</option>)}
      </select>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="demo-check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{label}</label>;
}

/** Demo shell: the persistent notice, the demo controls, and the app on a synthetic in-memory API. */
export function DemoRoot() {
  const [cfg, setCfg] = useState<DemoConfig>(() => parseConfig(window.location.hash));
  const [open, setOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const panelId = useId();
  const prev = useRef(cfg);

  // A new API (and a fresh app) whenever a state that changes what the API returns changes, or on Reset.
  const api = useMemo(() => new DemoExamApi(cfg), [cfg.mock, cfg.today, cfg.marks, cfg.outage, epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${cfg.mock}|${cfg.today}|${cfg.marks}|${cfg.outage}|${epoch}`;

  useEffect(() => {
    if (prev.current.offline !== cfg.offline) api.setOnline(!cfg.offline);
    prev.current = cfg;
  }, [cfg, api]);

  useEffect(() => {
    const h = configToHash(cfg);
    if (h !== window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`);
  }, [cfg]);

  useEffect(() => {
    if (cfg.theme === 'auto') return initTheme();
    applyTheme(cfg.theme);
    return undefined;
  }, [cfg.theme]);

  const set = <K extends keyof DemoConfig>(k: K, v: DemoConfig[K]) => setCfg(c => ({ ...c, [k]: v }));

  return (
    <>
      <div className="demo-bar" role="region" aria-label="Demo notice">
        <span className="demo-text">Demo · sample data, nothing is saved</span>
        <button type="button" className="demo-toggle" aria-expanded={open} aria-controls={panelId} aria-label="Demo controls" onClick={() => setOpen(o => !o)}>
          Controls
        </button>
      </div>
      {open && (
        <div className="demo-panel" id={panelId} role="group" aria-label="Demo controls">
          <Select label="Mock" value={cfg.mock} options={MOCK_LABELS} onChange={v => set('mock', v)} />
          <Select label="Today" value={cfg.today} options={TODAY_LABELS} onChange={v => set('today', v)} />
          <Select label="Marks" value={cfg.marks} options={MARKS_LABELS} onChange={v => set('marks', v)} />
          <Select label="Theme" value={cfg.theme} options={{ auto: 'Follow device', light: 'Light', dark: 'Dark' }} onChange={v => set('theme', v)} />
          <Check label="Brain is down (error state)" checked={cfg.outage} onChange={v => set('outage', v)} />
          <Check label="Offline (answers are held)" checked={cfg.offline} onChange={v => set('offline', v)} />
          <Check label="Access ended" checked={cfg.accessEnded} onChange={v => set('accessEnded', v)} />
          <Check label="New version banner" checked={cfg.release} onChange={v => set('release', v)} />
          <div className="demo-actions">
            <button type="button" onClick={() => { setCfg(DEFAULTS); setEpoch(e => e + 1); }}>Reset everything</button>
            <button type="button" onClick={() => setEpoch(e => e + 1)}>Restart this state</button>
          </div>
          <p className="demo-hint">Mock flow: choose &ldquo;In progress&rdquo;, open Mock, Resume, then Submit. Items on Today include MCQ, MSQ and NAT; tap Write on a NAT item for handwriting. The page address keeps the state, so a link opens the same view.</p>
        </div>
      )}
      <Root
        key={key}
        api={api}
        tutorHref="#tutor-is-not-part-of-the-demo"
        releaseAvailable={cfg.release}
        access={cfg.accessEnded ? { endedOn: '30 Nov', renewHref: '#renew-is-not-part-of-the-demo' } : undefined}
      />
    </>
  );
}
