/**
 * KaTeX render at sync (plan E5, E8). One owner of: splitting item text into
 * prose and maths, rendering with the safe KaTeX options, and cleaning the
 * output. Prose is HTML-escaped here, so nothing in an item stem can become a tag.
 *
 * Item text convention: inline maths in $...$, display maths in $$...$$,
 * a literal dollar as \$. The item schema stores plain strings with this convention.
 */
import katex from 'katex';
import { BrainError } from '../errors.js';
import type { Item } from '../item/schema.js';
import { sanitizeKatexHtml } from './sanitize.js';

export const KATEX_VERSION: string = katex.version;

/** Bounded expansion: stops macro bombs. KaTeX's own default is 1000. */
export const MAX_EXPAND = 200;
export const MAX_ITEM_FIELD_CHARS = 20_000;

export interface RenderedItem {
  stem: string;
  options: string[];
  solution: string;
}

type Segment = { kind: 'text' | 'inline' | 'display'; value: string };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Split into prose and maths segments. An unbalanced $ is an error, never guessed. */
export function splitMath(text: string): Segment[] {
  const segs: Segment[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) segs.push({ kind: 'text', value: buf });
    buf = '';
  };
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '$') {
      buf += '$';
      i += 2;
    } else if (text[i] === '$') {
      const display = text[i + 1] === '$';
      const open = display ? 2 : 1;
      let j = i + open;
      let end = -1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '$' && (!display || text[j + 1] === '$')) {
          end = j;
          break;
        }
        j++;
      }
      if (end < 0) throw new BrainError('RenderFailed', `unterminated ${display ? '$$' : '$'} in "${text.slice(i, i + 30)}"`);
      const body = text.slice(i + open, end);
      if (body.trim() === '') throw new BrainError('RenderFailed', 'empty maths segment');
      flush();
      segs.push({ kind: display ? 'display' : 'inline', value: body });
      i = end + open;
    } else {
      buf += text[i];
      i++;
    }
  }
  flush();
  return segs;
}

function renderMath(tex: string, displayMode: boolean): string {
  const violations: string[] = [];
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'error',
      maxExpand: MAX_EXPAND,
      maxSize: 50,
      // With trust:false KaTeX renders \href etc. as red text instead of throwing. We want a
      // hard failure, so the callback records the attempt and still returns false.
      trust: (ctx) => {
        violations.push(ctx.command);
        return false;
      },
    });
  } catch (e) {
    throw new BrainError('RenderFailed', `KaTeX rejected "${tex.slice(0, 60)}": ${(e as Error).message.split('\n')[0]}`);
  }
  if (violations.length) throw new BrainError('RenderFailed', `untrusted command ${violations[0]} in "${tex.slice(0, 60)}"`);
  return html;
}

/** Render one text field (stem, one option, or the solution) to cleaned HTML. */
export function renderText(text: string): string {
  if (text.length > MAX_ITEM_FIELD_CHARS) throw new BrainError('RenderFailed', `field is ${text.length} characters, limit ${MAX_ITEM_FIELD_CHARS}`);
  const raw = splitMath(text)
    .map((s) => (s.kind === 'text' ? escapeHtml(s.value) : renderMath(s.value, s.kind === 'display')))
    .join('');
  const { html, removed } = sanitizeKatexHtml(raw);
  if (removed.length) throw new BrainError('RenderUnsafe', `cleaner changed the output: ${removed.slice(0, 3).join('; ')}`);
  return html;
}

/** Render the stem, options and solution of an item. Throws RenderFailed or RenderUnsafe, naming the item. */
export function renderItemMath(item: Pick<Item, 'id' | 'stem' | 'options' | 'solution'>): RenderedItem {
  const where = (field: string, e: unknown): never => {
    if (e instanceof BrainError && (e.code === 'RenderFailed' || e.code === 'RenderUnsafe')) {
      throw new BrainError(e.code, `item ${item.id} ${field}: ${e.message.replace(/^[A-Za-z]+: /, '')}`);
    }
    throw e;
  };
  const one = (field: string, t: string): string => {
    try {
      return renderText(t);
    } catch (e) {
      return where(field, e);
    }
  };
  return {
    stem: one('stem', item.stem),
    options: (item.options ?? []).map((o, i) => one(`option ${i}`, o)),
    solution: one('solution', item.solution.text),
  };
}
