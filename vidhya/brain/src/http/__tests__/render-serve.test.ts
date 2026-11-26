import { describe, it, expect, afterEach } from 'vitest';
import { harness, makePack, PRACTICE, MOCK_ITEMS, mcqAns, T0, at, min, type Harness } from './harness.js';
import { buildPack } from '../../pack/pack.js';
import { GATE_LIKE } from '../../scoring/__tests__/fixtures.js';
import { TIERS } from './harness.js';
import type { Item } from '../../item/schema.js';
import { renderOnSync } from '../../render/index.js';
import { openStore } from '../../store/db.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

const mathy = (o: Partial<Item> & Pick<Item, 'id'>): Item => ({ ...PRACTICE[0]!, stem: 'Find $x^2$ when $x=3$', options: ['$1$', '$9$', '$x$', 'none'], key: 1, solution: { text: 'Since $x=3$, $x^2=9$.', checked: true }, ...o });

function packWith(extra: Item[], section_marks?: number) {
  return buildPack({
    version: 'pack-r1', marking: GATE_LIKE, timing: { total_minutes: 180, total_marks: 100 },
    topics: [{ id: 't1', label: 'Linear algebra', weight_marks: 6 }], tiers: TIERS,
    mock: { form_version: 'f1', opens_on: '2026-12-13', closes_on: '2026-12-20', planned_close: '2026-12-20' },
    section_marks, items: [...PRACTICE, ...extra, ...MOCK_ITEMS],
  });
}

describe('serve path uses pre-rendered KaTeX HTML', () => {
  it('stem, options and the solution after a check are KaTeX markup, not escaped text', async () => {
    h = await harness({ pack: packWith([mathy({ id: 'math1' })]) });
    const it1 = await h.call('GET', '/v1/items/math1');
    expect(it1.status).toBe(200);
    expect(it1.json.stemHtml).toContain('class="katex"');
    expect(it1.json.stemHtml).not.toContain('$');
    expect(it1.json.options[1].html).toContain('class="katex"');
    const chk = await h.call('POST', '/v1/items/math1/check', { body: { answer: mcqAns('B') } });
    expect(chk.json.result.reasonHtml).toContain('class="katex"');
    expect(chk.json.result.reason).toBe('Since $x=3$, $x^2=9$.'); // plain text stays for older clients
  });
  it('prose is still escaped', async () => {
    h = await harness();
    const r = await h.call('GET', '/v1/items/p1');
    expect(r.json.stemHtml).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('mock items are rendered too', async () => {
    h = await harness({ pack: packWith([]) });
    const a = await h.call('POST', '/v1/mock/attempts', { body: {} });
    expect(a.status).toBe(200);
    expect(a.json.items[0].stemHtml).toBe('Mock stem 1');
  });
});

describe('an item that cannot be rendered is not servable', () => {
  const bad = mathy({ id: 'bad1', topic_id: 't1', stem: 'cost is $5 only' });
  it('is filtered out of topics, topic items and Today; a direct request gets RenderFailed', async () => {
    h = await harness({ pack: packWith([bad]) });
    expect(h.db.prepare("SELECT status FROM rendered_items WHERE item_id = 'bad1'").get()).toEqual({ status: 'failed' });
    const topic = await h.call('GET', '/v1/topics/t1/items');
    expect(topic.json.map((x: { id: string }) => x.id)).not.toContain('bad1');
    expect(topic.json.length).toBeGreaterThan(0);
    const today = await h.call('GET', '/v1/today?minutes=240');
    expect(today.json.items.map((x: { id: string }) => x.id)).not.toContain('bad1');
    const direct = await h.call('GET', '/v1/items/bad1');
    expect(direct.status).toBe(503);
    expect(direct.json.code).toBe('RenderFailed');
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM practice_serves WHERE item_id = 'bad1'").get()).toEqual({ n: 0 });
  });
  it('an item never rendered says RenderMissing, and raw TeX is never the fallback', async () => {
    h = await harness({ pack: packWith([mathy({ id: 'new1' })]), render: false });
    const r = await h.call('GET', '/v1/items/p1');
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('RenderMissing');
    expect(r.text).not.toContain('\\frac');
    expect((await h.call('GET', '/v1/today')).json.cleared).toBe(true);
  });
  it('boot render is idempotent: a second pass renders nothing new', () => {
    const db = openStore(':memory:');
    const pack = makePack();
    const first = renderOnSync(db, pack.items, { now: T0 });
    const second = renderOnSync(db, pack.items, { now: at(T0, min(1)) });
    expect(first.rendered.length).toBe(pack.items.length);
    expect(second.rendered).toEqual([]);
    expect(second.skipped.length).toBe(pack.items.length);
  });
});

describe('/v1/marks', () => {
  it('needs_more: the fixed sentence, no range, taxonomy empty', async () => {
    h = await harness();
    const r = await h.call('GET', '/v1/marks');
    expect(r.json).toMatchObject({ status: 'needs_more', range: null, basis: 'Take the mock to see your marks range.', attempts: 0, taxonomy: [] });
  });
  it('ok after 30 attempts: low/high within section_marks (from exam.json), label names the count, UNCLASSIFIED shown', async () => {
    h = await harness({ pack: packWith([], 20), rateLimit: 1000 });
    await h.call('GET', '/v1/items/p1');
    for (let i = 0; i < 30; i++) {
      const r = await h.call('POST', '/v1/items/p1/check', { body: { answer: mcqAns(i % 3 === 0 ? 'A' : 'B') } });
      expect(r.status).toBe(200);
    }
    const m = await h.call('GET', '/v1/marks');
    expect(m.json.status).toBe('ok');
    expect(m.json.basis).toBe('estimate from 30 attempts');
    expect(m.json.range.of).toBe(20);
    expect(m.json.range.low).toBeLessThanOrEqual(m.json.range.high);
    expect(m.json.range.high).toBeLessThanOrEqual(20);
    const labels = m.json.taxonomy.map((x: { label: string; wrong: number }) => x.label);
    expect(labels).toContain('Unclassified');
    expect(m.json.wrongTotal).toBe(10);
  });
  it('section_marks defaults to the topics\' weight sum and is validated', () => {
    expect(makePack().section_marks).toBe(11);
    expect(packWith([], 15).section_marks).toBe(15);
    expect(() => packWith([], -1)).toThrow(/section_marks/);
    expect(() => packWith([], 'x' as never)).toThrow(/section_marks/);
  });
});
