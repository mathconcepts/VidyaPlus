import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@vidhya/ui/components/Button';
import { tryParseNat } from '@vidhya/shared/nat-input';
import type { Point, Stroke } from './types';
import type { Recognizer } from './model';
import type { Decoded } from './decode';
import { loadRecognizer } from './recognizer';

/** Pen width in canvas CSS pixels; the recogniser is told the same number. */
export const PEN_PX = 5;

type Load = { state: 'loading' } | { state: 'ready'; recognize: Recognizer } | { state: 'error' };

/**
 * Handwriting pad for practice NAT items (DR15b). Draw with a finger, stylus or
 * mouse; the model (loaded on first open) proposes a string; the student confirms
 * it and only then does it fill the answer field. It never submits anything.
 * The keypad stays the keyboard path.
 */
export default function HandwritingPad({ onConfirm, loader = loadRecognizer, autoReadMs = 450 }: {
  onConfirm: (text: string) => void;
  /** Injectable for tests. */
  loader?: () => Promise<Recognizer>;
  autoReadMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<{ id: number; stroke: Stroke } | null>(null);
  const seq = useRef(0);
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reading, setReading] = useState(false);
  const [proposal, setProposal] = useState<Decoded | null>(null);
  const hintId = useId();
  const previewId = useId();

  useEffect(() => {
    let live = true;
    loader().then(recognize => { if (live) setLoad({ state: 'ready', recognize }); }, () => { if (live) setLoad({ state: 'error' }); });
    return () => { live = false; };
  }, [loader]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext?.('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    const w = Math.round((rect.width || 300) * dpr), h = Math.round((rect.height || 180) * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = getComputedStyle(c).color; // follows the theme (--text-primary)
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = PEN_PX; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of [...strokes.current, ...(drawing.current ? [drawing.current.stroke] : [])]) {
      if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0].x, s[0].y, PEN_PX / 2, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.beginPath(); s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    }
  }, []);

  useEffect(() => { redraw(); }, [version, redraw]);
  useEffect(() => {
    // Repaint when the theme flips, so strokes never stay in the old ink colour.
    const obs = typeof MutationObserver === 'undefined' ? null : new MutationObserver(redraw);
    obs?.observe(document.documentElement, { attributes: true });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', redraw);
    return () => { obs?.disconnect(); mq?.removeEventListener?.('change', redraw); };
  }, [redraw]);

  // Read after the student pauses.
  useEffect(() => {
    if (load.state !== 'ready') return;
    if (strokes.current.length === 0) { setProposal(null); setReading(false); return; }
    const mine = ++seq.current;
    setReading(true);
    const t = setTimeout(() => {
      load.recognize(strokes.current.map(s => s.slice()), PEN_PX).then(
        d => { if (seq.current === mine) { setProposal(d); setReading(false); } },
        () => { if (seq.current === mine) { setProposal({ text: '', chars: [] }); setReading(false); } },
      );
    }, autoReadMs);
    return () => clearTimeout(t);
  }, [version, load, autoReadMs]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = { id: e.pointerId, stroke: [at(e)] };
    redraw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    d.stroke.push(at(e));
    redraw();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    strokes.current.push(d.stroke);
    setVersion(v => v + 1);
  };
  const undo = () => { strokes.current.pop(); setVersion(v => v + 1); };
  const clear = () => { strokes.current = []; setVersion(v => v + 1); };

  const text = proposal?.text ?? '';
  const shown = text.replace('-', '−');
  const parses = text !== '' && tryParseNat(text).ok;
  const has = strokes.current.length > 0;

  if (load.state === 'error') {
    return <p role="status" className="hw-note">Handwriting isn't available right now. Use the keypad below.</p>;
  }
  return (
    <div className="hw" role="group" aria-label="Handwriting pad">
      <canvas
        ref={canvasRef}
        className="hw-canvas"
        role="img"
        aria-label="Writing area. Draw your answer with a finger, stylus or mouse. The keypad below works without drawing."
        aria-describedby={hintId}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <p id={hintId} className="hw-note">
        {load.state === 'loading' ? 'Loading handwriting reader…' : 'Write the number in the box, leaving a small gap between characters.'}
      </p>
      <p id={previewId} aria-live="polite" className="hw-preview">
        {reading && 'Reading…'}
        {!reading && proposal && text !== '' && <>Read as <span className="mono">{shown}</span>{parses ? '' : " · doesn't read as a number yet"}. Check it, then confirm.</>}
        {!reading && proposal && text === '' && "Couldn't read that. Undo, try again, or use the keypad."}
      </p>
      <div className="hw-actions">
        <Button variant="grey" tone="neutral" size="md" disabled={!has} onClick={undo} ariaLabel="Undo last stroke">Undo</Button>
        <Button variant="grey" tone="neutral" size="md" disabled={!has} onClick={clear} ariaLabel="Clear writing">Clear</Button>
        <Button variant="filled" tone="action" size="md" disabled={reading || text === ''} onClick={() => onConfirm(text)} ariaLabel={text ? `Use ${shown} as my answer` : 'Use the recognised answer'}>Use this</Button>
      </div>
    </div>
  );
}
