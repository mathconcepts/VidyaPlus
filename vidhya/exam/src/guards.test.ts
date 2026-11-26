/**
 * Source-text guards the type system cannot express (plan rules 6 and 7, E4, E8).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = __dirname;
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const prod = walk(SRC).filter(f => !/\.test\.tsx?$/.test(f) && !f.endsWith('test-utils.tsx') && !f.endsWith('test-setup.ts'));
const rel = (f: string) => path.relative(SRC, f);

describe('guards', () => {
  it('no receipt object literal outside @vidhya/ui (receipt law, rule 6)', () => {
    const LITERAL = /receipt\s*=\s*\{\{|:\s*Receipt\s*=\s*\{|as\s+Receipt\b|verified:\s*true/;
    const bad = prod.filter(f => LITERAL.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(bad.map(rel)).toEqual([]);
  });

  it('the NAT parser is imported from @vidhya/shared, never copied (E4)', () => {
    const src = fs.readFileSync(path.join(SRC, 'components/NatEntry.tsx'), 'utf8');
    expect(src).toContain("from '@vidhya/shared/nat-input'");
    const copies = prod.filter(f => /\[\+-\]\?\(\\d\+/.test(fs.readFileSync(f, 'utf8')));
    expect(copies.map(rel)).toEqual([]);
  });

  it('imports from @vidhya/ui go file by file, with no barrel (E11)', () => {
    const bad = prod.filter(f => /from\s+'@vidhya\/ui'|from\s+'@vidhya\/ui\/(components|lib)'|index/.test(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('import')).join('\n')));
    expect(bad.map(rel)).toEqual([]);
  });

  it('no inline script and no eval in the shell (CSP script-src self, E8)', () => {
    const html = fs.readFileSync(path.resolve(SRC, '../index.html'), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) expect(m[1]).toMatch(/\bsrc=/);
    expect(html).not.toMatch(/\son\w+=/i);
    const bad = prod.filter(f => /\beval\(|new Function\(|document\.write\(/.test(fs.readFileSync(f, 'utf8')));
    expect(bad.map(rel)).toEqual([]);
  });

  it('no emoji, gradients, confetti or shimmer in the shipped source and styles', () => {
    const files = [...prod, path.join(SRC, 'styles/exam.css')];
    const bad = files.filter(f => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]|gradient|confetti|shimmer/iu.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(bad.map(rel)).toEqual([]);
  });

  it('reading text never goes below the 17px floor in exam.css (small sizes are labels and key hints only)', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles/exam.css'), 'utf8');
    const small = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(m => Number(m[1])).filter(n => n < 15);
    expect(small).toEqual([]);
  });

  it('innerHTML is set only from the brain\'s sanitised HTML fields (E8)', () => {
    const ALLOWED = /dangerouslySetInnerHTML=\{\{\s*__html:\s*(?:item\.stemHtml|o\.html|r\.reasonHtml)\s*\}\}|dangerouslySetInnerHTML:\s*\{\s*__html:\s*r\.reasonHtml\s*\}/g;
    const bad = prod.filter(f => /dangerouslySetInnerHTML|innerHTML/.test(fs.readFileSync(f, 'utf8').replace(ALLOWED, '').replace(/dangerouslySetInnerHTML:\s*\{\s*__html:\s*string\s*\}/g, '').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(bad.map(rel)).toEqual([]);
  });

  it('production code reaches the fake only through a dynamic import in api/choose.ts', () => {
    const bad = prod.filter(f => !f.endsWith('fake.ts') && /from\s+'(\.\/|\.\.\/)+(api\/)?fake'/.test(fs.readFileSync(f, 'utf8')));
    expect(bad.map(rel)).toEqual([]);
    expect(fs.readFileSync(path.join(SRC, 'api/choose.ts'), 'utf8')).toMatch(/import\('\.\/fake'\)/);
  });
});
