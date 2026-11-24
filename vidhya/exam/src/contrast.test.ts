/**
 * Contrast pass (DR17, T36): every text/background pair /exam draws, in both
 * themes, reaches 4.5:1. Computed from the real token files, because jsdom
 * cannot lay a page out for axe's own colour-contrast rule. Green, orange and
 * red TEXT uses the -ink variants only.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const colors = read('../../ui/styles/tokens/colors.css');
const exam = read('./styles/exam.css');

function block(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`${selector.replace(/[[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].replace(/\/\*.*?\*\//g, '').trim();
  return out;
}

type RGBA = [number, number, number, number];
function parse(v: string, tokens: Record<string, string>): RGBA {
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return parse(tokens[ref[1]], tokens);
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgba) { const p = rgba[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`cannot parse ${v}`);
}
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as RGBA;
const lum = ([r, g, b]: RGBA) => { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** Contrast of `fg` painted on `bg`; a translucent fg is composited over bg first. */
const ratio = (fg: RGBA, bg: RGBA) => { const a = over(fg, bg); return ratioOpaque(a, bg); };
const ratioOpaque = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const light = { ...block(colors, ':root'), ...block(exam, ':root') };
const dark = { ...light, ...block(colors, '[data-theme="dark"]'), ...block(exam, '[data-theme="dark"]') };

function resolve(tokens: Record<string, string>, spec: string): RGBA {
  // "a over b over c": layers painted left to right on the right-most opaque colour.
  const layers = spec.split(' over ').map(s => parse(`var(--${s})`, tokens));
  return layers.reduceRight((under, top) => over(top, under));
}

const PAIRS: Array<[string, string]> = [
  ['text-primary', 'surface-canvas'], ['text-primary', 'surface-card'], ['text-primary', 'surface-sunken'], ['text-primary', 'surface-fill over surface-canvas'],
  ['text-secondary', 'surface-canvas'], ['text-secondary', 'surface-card'], ['text-secondary', 'surface-sunken'],
  ['green-ink', 'surface-card'], ['green-ink', 'surface-canvas'], ['green-ink', 'green-tint over surface-card'], ['green-ink', 'green-tint over surface-canvas'],
  ['red-ink', 'surface-card'], ['red-ink', 'surface-canvas'], ['red-ink', 'red-tint over surface-card'], ['red-ink', 'surface-sunken'],
  ['orange-ink', 'surface-card'], ['orange-ink', 'orange-tint over surface-card'],
  ['indigo-ink', 'surface-card'], ['indigo-ink', 'surface-canvas'],
  ['on-action', 'action-solid'], ['on-action', 'action-press'],
  ['surface-card', 'ink'],
];

describe.each([['light', light], ['dark', dark]] as const)('contrast >= 4.5:1 (%s)', (_name, tokens) => {
  it.each(PAIRS)('%s on %s', (fg, bg) => {
    const r = ratio(resolve(tokens, fg), resolve(tokens, bg));
    expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the pair checker itself', () => {
  it('knows the 60% Apple secondary label is below 4.5 on white, and white on --green too', () => {
    const t = block(colors, ':root');
    expect(ratio(resolve(t, 'text-secondary'), resolve(t, 'surface-card'))).toBeLessThan(4.5);
    expect(ratio(resolve(t, 'text-on-accent'), resolve(t, 'green'))).toBeLessThan(4.5);
  });
});
