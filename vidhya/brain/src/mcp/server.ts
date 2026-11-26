/**
 * The tutor MCP endpoint, mounted at /mcp on the brain's HTTP server (Streamable HTTP, stateless:
 * a fresh server per request, so nothing about one tutor call can leak into another).
 * Network-wise it is meant to be reachable only on the DeepTutor <-> brain docker network; Caddy
 * proxies /exam/* only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { BrainError } from '../errors.js';
import { toApiError } from '../http/errors.js';
import type { Deps } from '../service/deps.js';
import { makeTutorTools } from './tutor.js';

const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mcq'), key: z.string().describe('the chosen option letter, e.g. "B"') }),
  z.object({ kind: z.literal('msq'), keys: z.array(z.string()).describe('every chosen option letter') }),
  z.object({ kind: z.literal('nat'), raw: z.string().describe('the typed number, e.g. "2.45"') }),
]);

export function buildMcpServer(tools: ReturnType<typeof makeTutorTools>): McpServer {
  const server = new McpServer({ name: 'vidhya-brain', version: '0.1.0' });
  const run = (fn: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(fn()) }] };
    } catch (e) {
      if (e instanceof BrainError) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toApiError(e).body) }] };
      throw e;
    }
  };
  server.registerTool(
    'check_answer',
    { description: 'Grade a student answer on a practice question. Records nothing and never reveals the key. Refuses mock questions.', inputSchema: { item_id: z.string(), answer: answerSchema } },
    (a) => run(() => tools.check_answer(a as never)),
  );
  server.registerTool(
    'explain_receipt',
    { description: 'How a question was verified: method, engines, reviewer and date. Never the values. Refuses mock questions.', inputSchema: { item_id: z.string() } },
    (a) => run(() => tools.explain_receipt(a)),
  );
  server.registerTool(
    'report_item',
    { description: 'Report a question as possibly wrong. Goes to the reviewer only; the question is not removed. Refuses mock questions.', inputSchema: { item_id: z.string(), note: z.string().max(280).optional() } },
    (a) => run(() => tools.report_item(a)),
  );
  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new BrainError('PayloadTooLarge', 'request body is too large');
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new BrainError('BadRequest', 'body is not valid JSON');
  }
}

/** One tool set per Deps, so the report cap survives across requests (each request gets a fresh MCP server). */
const toolsByDeps = new WeakMap<Deps, ReturnType<typeof makeTutorTools>>();

export async function handleMcp(req: IncomingMessage, res: ServerResponse, d: Deps, opts: { now?: () => Date } = {}): Promise<void> {
  if (req.method !== 'POST') {
    // Stateless server: no SSE stream and no session to delete.
    res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'MethodNotAllowed', message: 'POST only' }));
    return;
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    const err = toApiError(e);
    res.writeHead(err.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(err.body));
    return;
  }
  let tools = toolsByDeps.get(d);
  if (!tools) { tools = makeTutorTools(d, opts); toolsByDeps.set(d, tools); }
  const server = buildMcpServer(tools);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
