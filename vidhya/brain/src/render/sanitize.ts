/**
 * Allowlist cleaner for KaTeX output (plan E8). It is deliberately small: KaTeX
 * emits a fixed vocabulary of span / MathML / SVG tags, so anything outside that
 * vocabulary is not KaTeX output and is removed. It reports what it removed so
 * the sync can fail the item by name instead of serving a silently-altered page.
 *
 * Guarantees of the output: no <script>, no event-handler attributes, no href /
 * src / xlink:href, no url() or expression() in style, only allowlisted tags,
 * attributes and CSS properties. Inline style attributes survive (KaTeX needs
 * them for layout); the /exam CSP is script-src 'self' and does not restrict them.
 */

const TAGS = new Set([
  'span',
  // MathML
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac',
  'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle', 'mpadded', 'mphantom', 'menclose',
  // SVG, as KaTeX draws stretchy arrows, radicals and rules
  'svg', 'path', 'line',
]);


const ATTRS = new Set([
  'class', 'style', 'aria-hidden', 'xmlns', 'encoding',
  'mathvariant', 'display', 'displaystyle', 'scriptlevel', 'stretchy', 'fence', 'separator', 'lspace', 'rspace',
  'minsize', 'maxsize', 'accent', 'accentunder', 'columnalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines',
  'width', 'height', 'depth', 'voffset', 'linethickness', 'notation', 'mathcolor', 'mathbackground', 'symmetric',
  'viewBox', 'preserveAspectRatio', 'd', 'x1', 'y1', 'x2', 'y2', 'stroke-width',
]);

const XMLNS_OK = new Set(['http://www.w3.org/1998/Math/MathML', 'http://www.w3.org/2000/svg']);

const STYLE_PROPS = new Set([
  'height', 'width', 'min-width', 'max-width', 'vertical-align', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
  'top', 'left', 'right', 'bottom', 'padding-left', 'padding-right', 'border-bottom-width', 'border-top-width',
  'border-left-width', 'border-right-width', 'border-color', 'border-bottom-color', 'border-top-color', 'color',
  'background-color', 'position', 'display', 'font-size', 'font-family', 'font-weight', 'font-style', 'line-height',
]);

const CLASS_VALUE = /^[A-Za-z0-9 _-]*$/;
const PLAIN_VALUE = /^[A-Za-z0-9 .,%#:_+\-()/]*$/;
const PATH_VALUE = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,\-eE]*$/;
const CSS_VALUE = /^[#A-Za-z0-9 .,%()+\-]+$/;
const BAD_VALUE = /url\s*\(|expression|javascript|data:|vbscript|@import|var\s*\(|\\/i;
const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9:-]*(?:="[^"<>]*")?)*)\s*(\/?)>/;
const ATTR = /\s+([A-Za-z][A-Za-z0-9:-]*)(?:="([^"<>]*)")?/gy;

export interface SanitizeResult {
  html: string;
  /** Human-readable list of everything the cleaner dropped or changed. Empty means the input was already clean. */
  removed: string[];
}

function cleanStyle(value: string, removed: string[]): string | null {
  const out: string[] = [];
  for (const decl of value.split(';')) {
    if (decl.trim() === '') continue;
    const i = decl.indexOf(':');
    const prop = (i < 0 ? decl : decl.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? '' : decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !CSS_VALUE.test(val) || BAD_VALUE.test(val)) {
      removed.push(`style ${prop || '?'}:${val}`);
      continue;
    }
    out.push(`${prop}:${val};`);
  }
  return out.length ? out.join('') : null;
}

function cleanAttr(tag: string, name: string, value: string, removed: string[]): string | null {
  if (!ATTRS.has(name)) {
    removed.push(`attribute ${name} on <${tag}>`);
    return null;
  }
  if (name === 'style') return cleanStyle(value, removed);
  if (BAD_VALUE.test(value)) {
    removed.push(`attribute ${name}="${value}" on <${tag}>`);
    return null;
  }
  const ok =
    name === 'class' ? CLASS_VALUE.test(value)
    : name === 'd' ? PATH_VALUE.test(value)
    : name === 'xmlns' ? XMLNS_OK.has(value)
    : name === 'encoding' ? value === 'application/x-tex'
    : PLAIN_VALUE.test(value);
  if (!ok) {
    removed.push(`attribute ${name}="${value}" on <${tag}>`);
    return null;
  }
  return value;
}

/** Clean KaTeX HTML. Never throws; the caller decides what a non-empty `removed` means. */
export function sanitizeKatexHtml(input: string): SanitizeResult {
  const removed: string[] = [];
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '<') {
      const m = TAG.exec(input.slice(i));
      if (!m) {
        removed.push('malformed tag');
        out.push('&lt;');
        i += 1;
        continue;
      }
      const [whole, slash, rawName, attrText, selfClose] = m as unknown as [string, string, string, string, string];
      i += whole.length;
      const name = rawName.toLowerCase() === rawName ? rawName : rawName.toLowerCase();
      if (!TAGS.has(name)) {
        removed.push(`<${slash}${name}>`);
        continue;
      }
      if (slash) {
        if (stack[stack.length - 1] === name) {
          stack.pop();
          out.push(`</${name}>`);
        } else {
          removed.push(`unbalanced </${name}>`);
        }
        continue;
      }
      const attrs: string[] = [];
      ATTR.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR.exec(attrText)) !== null) {
        const v = cleanAttr(name, a[1]!, a[2] ?? '', removed);
        if (v !== null) attrs.push(` ${a[1]}="${v}"`);
      }
      out.push(`<${name}${attrs.join('')}>`);
      if (selfClose) {
        out.push(`</${name}>`);
      } else {
        stack.push(name);
      }
      continue;
    }
    if (ch === '>') {
      removed.push('stray >');
      out.push('&gt;');
      i += 1;
      continue;
    }
    if (ch === '&') {
      const m = ENTITY.exec(input.slice(i));
      if (m) {
        out.push(m[0]);
        i += m[0].length;
      } else {
        removed.push('bare &');
        out.push('&amp;');
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  while (stack.length) {
    removed.push(`unclosed <${stack.pop()}>`);
  }
  return { html: out.join(''), removed };
}
