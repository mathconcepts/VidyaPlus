import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { harness, mcqAns, natAns, T0, PRACTICE_SOLUTION, MOCK_SOLUTION, RECEIPT_VALUE, type Harness } from '../../http/__tests__/harness.js';
import { REPORTS_PER_MINUTE } from '../tutor.js';

let h: Harness;
let client: Client | undefined;
afterEach(async () => { await client?.close(); client = undefined; await h?.close(); });

async function connect(): Promise<Client> {
  h = await harness();
  client = new Client({ name: 'test-tutor', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.base}/mcp`)));
  return client;
}
type ToolOut = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client!.callTool({ name, arguments: args })) as ToolOut;
  return { isError: r.isError === true, text: r.content[0]!.text, json: JSON.parse(r.content[0]!.text) as any };
};
const attempts = () => h.db.prepare('SELECT COUNT(*) AS n FROM attempts').get();

describe('tutor MCP at /mcp', () => {
  it('lists exactly the three identity-free tools; none takes a student', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_answer', 'explain_receipt', 'report_item']);
    for (const t of tools) expect(JSON.stringify(t.inputSchema)).not.toMatch(/student|user|session/i);
  });

  it('check_answer grades, records nothing, and never reveals the key', async () => {
    await connect();
    const right = await call('check_answer', { item_id: 'p1', answer: mcqAns('B') });
    expect(right.json).toEqual({ correct: true, marks_awarded: 1, max: 1, feedback: 'Correct.', key_revealed: false });
    const wrong = await call('check_answer', { item_id: 'p1', answer: mcqAns('A') });
    expect(wrong.json).toMatchObject({ correct: false, key_revealed: false });
    expect(wrong.text).not.toContain(PRACTICE_SOLUTION);
    expect((await call('check_answer', { item_id: 'p3', answer: natAns('2') })).json.correct).toBe(true);
    expect(attempts()).toEqual({ n: 0 });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM practice_serves').get()).toEqual({ n: 0 });
  });

  it('HTTP and MCP grade the same answers the same way (one grading path)', async () => {
    await connect();
    for (const [id, ans] of [['p1', mcqAns('B')], ['p1', mcqAns('C')], ['p3', natAns('2.5')], ['p2', { kind: 'msq', keys: ['A', 'D'] }]] as const) {
      await h.call('GET', `/v1/items/${id}`);
      const viaHttp = (await h.call('POST', `/v1/items/${id}/check`, { body: { answer: ans } })).json.result;
      const viaMcp = (await call('check_answer', { item_id: id, answer: ans })).json;
      expect(viaMcp.correct).toBe(viaHttp.outcome === 'correct');
      expect(viaMcp.marks_awarded).toBe(viaHttp.scored);
    }
  });

  it('check_answer refuses invalid picks like the scorer does', async () => {
    await connect();
    const r = await call('check_answer', { item_id: 'p1', answer: mcqAns('Z') });
    expect(r).toMatchObject({ isError: true, json: { code: 'InvalidResponse' } });
  });

  it('every tool refuses a mock item (MockItemRefused), and says nothing about it', async () => {
    await connect();
    for (const [tool, args] of [
      ['check_answer', { item_id: 'm1', answer: mcqAns('B') }],
      ['explain_receipt', { item_id: 'm1' }],
      ['report_item', { item_id: 'm1', note: 'x' }],
    ] as const) {
      const r = await call(tool, args);
      expect(r.isError, tool).toBe(true);
      expect(r.json.code).toBe('MockItemRefused');
      expect(r.text).not.toContain(MOCK_SOLUTION);
    }
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM disputes').get()).toEqual({ n: 0 });
    expect((await call('check_answer', { item_id: 'nope', answer: mcqAns('A') })).json.code).toBe('ItemNotFound');
  });

  it('explain_receipt gives method, engines, reviewer and date, and never any value', async () => {
    await connect();
    const r = await call('explain_receipt', { item_id: 'p1' });
    expect(r.json).toEqual({
      item_id: 'p1', verified: true, method: 'sympy recompute + wolfram', engines: ['SymPy', 'Wolfram'], engines_agree: true, reviewer: 'reviewer-1', reviewed_at: '2026-11-20',
    });
    expect(r.text).not.toContain(RECEIPT_VALUE);
    expect(r.text).not.toContain('fingerprint');
  });

  it('report_item goes to the review queue only: anonymous, not counted, no overlay row, no hiding', async () => {
    await connect();
    const r = await call('report_item', { item_id: 'p1', note: 'is B really right?' });
    expect(r.json.ok).toBe(true);
    expect(h.db.prepare('SELECT channel, student_hash, counted, state, note FROM disputes').all()).toEqual([
      { channel: 'mcp', student_hash: null, counted: 0, state: 'giri_queue', note: 'is B really right?' },
    ]);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM item_status').get()).toEqual({ n: 0 });
    expect((await h.call('GET', '/v1/items/p1')).status).toBe(200); // still served
  });

  it('report_item is capped per minute, so a looping or injected tutor cannot flood the queue', async () => {
    await connect();
    for (let i = 0; i < REPORTS_PER_MINUTE; i++) expect((await call('report_item', { item_id: 'p1' })).isError).toBe(false);
    const over = await call('report_item', { item_id: 'p1' });
    expect(over).toMatchObject({ isError: true, json: { code: 'RateLimited' } });
  });

  it('/mcp answers only POST and carries no-store', async () => {
    h = await harness();
    const g = await fetch(`${h.base}/mcp`);
    expect(g.status).toBe(405);
    expect(g.headers.get('cache-control')).toBe('private, no-store');
    const bad = await fetch(`${h.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
  });
  it('time is injected: the fixture clock is the contract date', () => { expect(T0.toISOString()).toBe('2026-12-13T09:00:00.000Z'); });
});
