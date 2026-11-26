import { describe, it, expect } from 'vitest';
import { openStore } from '../../store/db.js';
import { isBrainError } from '../../errors.js';
import { fingerprint, type Item } from '../../item/schema.js';
import { renderItemMath, renderText, splitMath, KATEX_VERSION } from '../katex.js';
import { sanitizeKatexHtml } from '../sanitize.js';
import { getRenderedItem, isRenderable, renderOnSync } from '../sync.js';

const item = (over: Partial<Item> = {}): Item => ({
  id: 'r1', pool: 'practice', type: 'MCQ', answer_kind: 'options', marks: 1, topic_id: 't', concept_id: 'c',
  stem: 'Evaluate $\\int_0^1 x^2\\,dx$ and then $$\\frac{a}{b}$$ done.', options: ['$\\frac13$', '$1$', 'plain', '$\\sqrt{2}$'], key: 0,
  solution: { text: 'Since $x^3/3$ at 1 is $1/3$.', checked: true }, status: 'verified', since_version: 'v0', ...over,
});

describe('splitMath', () => {
  it('splits prose, inline and display; \\$ is a literal dollar', () => {
    expect(splitMath('a $x$ b $$y$$ c \\$5')).toEqual([
      { kind: 'text', value: 'a ' }, { kind: 'inline', value: 'x' }, { kind: 'text', value: ' b ' },
      { kind: 'display', value: 'y' }, { kind: 'text', value: ' c $5' },
    ]);
  });
  it('refuses an unterminated or empty segment', () => {
    expect(() => splitMath('cost $5')).toThrow(/RenderFailed/);
    expect(() => splitMath('a $$ b')).toThrow(/RenderFailed/);
    expect(() => splitMath('a $ $ b')).toThrow(/RenderFailed/);
  });
});

describe('renderItemMath: correctness', () => {
  it('renders inline and display maths with MathML + HTML, and escapes prose', () => {
    const r = renderItemMath(item({ stem: 'If a<b & b>c then $x^2$ and $$\\frac{a}{b}$$' }));
    expect(r.stem).toContain('a&lt;b &amp; b&gt;c');
    expect(r.stem).toContain('class="katex"');
    expect(r.stem).toContain('katex-display');
    expect(r.stem).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
    expect(r.stem).toContain('<mfrac>');
    expect(r.options).toHaveLength(4);
    expect(r.options[2]).toBe('plain');
    expect(r.solution).toContain('katex-mathml');
  });
  it('handles an item with no options', () => {
    expect(renderItemMath(item({ options: undefined, type: 'NAT', answer_kind: 'number' })).options).toEqual([]);
  });
});

describe('renderItemMath: hostile input (E8)', () => {
  const hostile = [
    '\\href{javascript:alert(1)}{click}',
    '\\url{http://evil.example}',
    '\\htmlClass{x}{y}',
    '\\htmlId{x}{y}',
    '\\htmlStyle{color:red}{y}',
    '\\htmlData{a=b}{y}',
    '\\includegraphics{http://evil.example/x.png}',
  ];
  for (const tex of hostile) {
    it(`rejects ${tex.slice(0, 24)}`, () => {
      try {
        renderItemMath(item({ stem: `$${tex}$` }));
        throw new Error('should have thrown');
      } catch (e) {
        expect(isBrainError(e, 'RenderFailed')).toBe(true);
        expect((e as Error).message).toContain('item r1 stem');
      }
    });
  }
  it('rejects a macro bomb through the expansion cap', () => {
    const bomb = '\\def\\a{\\b\\b\\b\\b\\b\\b\\b\\b\\b\\b}\\def\\b{\\c\\c\\c\\c\\c\\c\\c\\c\\c\\c}\\def\\c{\\d\\d\\d\\d\\d\\d\\d\\d\\d\\d}\\def\\d{x}\\a';
    expect(() => renderItemMath(item({ solution: { text: `$${bomb}$`, checked: true } }))).toThrow(/RenderFailed/);
  });
  it('neutralises <script> and event handlers in prose: shown as text, never a tag', () => {
    const r = renderItemMath(item({ stem: 'x <script>alert(1)</script> <img src=x onerror=alert(1)> javascript:alert(1)' }));
    expect(r.stem).not.toMatch(/<script|<img|<[a-z]+[^>]* on\w+=/i);
    expect(r.stem).toContain('&lt;script&gt;');
  });
  it('a hostile option or solution is caught and named', () => {
    expect(() => renderItemMath(item({ options: ['$1$', '$\\href{x}{y}$'] }))).toThrow(/item r1 option 1/);
    expect(() => renderItemMath(item({ solution: { text: '$\\url{x}$', checked: true } }))).toThrow(/item r1 solution/);
  });
  it('strict mode refuses non-LaTeX maths input', () => {
    expect(() => renderText('$é$')).toThrow(/RenderFailed/);
  });
});

describe('sanitizeKatexHtml', () => {
  it('leaves real KaTeX output untouched', () => {
    const html = renderText('$\\sqrt{x}+\\frac{a}{b}+\\overrightarrow{AB}+\\sqrt[3]{y}$ and $$\\begin{matrix}a&b\\\\c&d\\end{matrix}$$');
    const r = sanitizeKatexHtml(html);
    expect(r.removed).toEqual([]);
    expect(r.html).toBe(html);
  });
  it('strips scripts, handlers, links, url() styles and reports them', () => {
    const dirty =
      '<span class="katex" onclick="x()" style="color:red;background:url(javascript:alert(1));height:1em">a</span>' +
      '<script>alert(1)</script><a href="javascript:alert(1)">b</a><svg onload="x()"><path d="M0 0L1 1" xlink:href="x"></path></svg>' +
      '<iframe src="x"></iframe><span class="a&quot;b">c</span>';
    const r = sanitizeKatexHtml(dirty);
    expect(r.removed.length).toBeGreaterThan(5);
    expect(r.html).not.toMatch(/<script|<a |<iframe|onclick|onload|href|url\(|javascript:/i);
    expect(r.html).toContain('style="color:red;height:1em;"');
  });
  it('escapes stray < > & and closes nothing it did not open', () => {
    const r = sanitizeKatexHtml('a < b > c & d <span>e');
    expect(r.html).toBe('a &lt; b &gt; c &amp; d <span>e');
    expect(r.removed).toContain('unclosed <span>');
  });
});

describe('CSP compatibility', () => {
  it('output has no script, no handler attributes, no external references', () => {
    const r = renderItemMath(item());
    const all = [r.stem, ...r.options, r.solution].join('');
    expect(all).not.toMatch(/<script/i);
    expect(all).not.toMatch(/\son[a-z]+=/i);
    expect(all).not.toMatch(/(href|src)=/i);
    expect(all).not.toMatch(/url\(/i);
    expect(all).toMatch(/style="/); // inline styles are expected: CSP is script-src 'self' only
  });
});

describe('renderOnSync', () => {
  it('stores rendered HTML by fingerprint and is idempotent', () => {
    const db = openStore(':memory:');
    const a = item();
    const first = renderOnSync(db, [a]);
    expect(first).toMatchObject({ rendered: ['r1'], skipped: [], failed: [] });
    const html = getRenderedItem(db, fingerprint(a));
    expect(html.stem).toContain('katex');
    const row1 = db.prepare('SELECT rendered_at FROM rendered_items').get();
    const second = renderOnSync(db, [a], { now: new Date('2030-01-01') });
    expect(second).toMatchObject({ rendered: [], skipped: ['r1'] });
    expect(db.prepare('SELECT rendered_at FROM rendered_items').get()).toEqual(row1);
    expect(db.prepare('SELECT COUNT(*) n FROM rendered_items').get()).toEqual({ n: 1 });
  });
  it('an errata (new fingerprint) renders a new row; the old row stays for history', () => {
    const db = openStore(':memory:');
    const a = item();
    const b = item({ solution: { text: 'Fixed $1/3$.', checked: true } });
    renderOnSync(db, [a]);
    const r = renderOnSync(db, [b]);
    expect(r.rendered).toEqual(['r1']);
    expect(db.prepare('SELECT COUNT(*) n FROM rendered_items').get()).toEqual({ n: 2 });
    expect(getRenderedItem(db, fingerprint(b)).solution).toContain('Fixed');
  });
  it('a KaTeX version bump re-renders under the new key', () => {
    const db = openStore(':memory:');
    const a = item();
    renderOnSync(db, [a]);
    const bumped = renderOnSync(db, [a], { katexVersion: '9.9.9' });
    expect(bumped.rendered).toEqual(['r1']);
    expect(getRenderedItem(db, fingerprint(a), { katexVersion: '9.9.9' }).stem).toContain('katex');
    expect((db.prepare('SELECT katex_version v FROM rendered_items ORDER BY v').all() as { v: string }[]).map((r) => r.v)).toEqual(['9.9.9', KATEX_VERSION].sort());
  });
  it('a render failure marks the item unservable with a named error and never serves raw TeX', () => {
    const db = openStore(':memory:');
    const bad = item({ id: 'bad1', stem: '$\\href{javascript:alert(1)}{x}$' });
    const good = item({ id: 'good1', stem: 'fine $x$' });
    const r = renderOnSync(db, [bad, good]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ item_id: 'bad1', code: 'RenderFailed' });
    expect(r.failed[0]!.message).toContain('bad1');
    expect(r.rendered).toEqual(['good1']);
    expect(isRenderable(db, fingerprint(bad))).toBe(false);
    expect(isRenderable(db, fingerprint(good))).toBe(true);
    try {
      getRenderedItem(db, fingerprint(bad));
      throw new Error('should throw');
    } catch (e) {
      expect(isBrainError(e, 'RenderFailed')).toBe(true);
    }
  });
  it('a never-rendered item is RenderMissing, not empty HTML', () => {
    const db = openStore(':memory:');
    expect(() => getRenderedItem(db, fingerprint(item()))).toThrow(/RenderMissing/);
  });
  it('a failed row is retried on the next sync (the item or KaTeX may have been fixed)', () => {
    const db = openStore(':memory:');
    const bad = item({ stem: '$\\url{x}$' });
    renderOnSync(db, [bad]);
    expect(renderOnSync(db, [bad]).failed).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) n FROM rendered_items').get()).toEqual({ n: 1 });
  });
});
