/**
 * B2 Wolfram engine. Ported from legacy `src/verification/verifiers/wolfram.ts`
 * (same Full Results API v2 query, JSON output, timeout via AbortController).
 *
 * Deliberate change: the legacy `compareAnswers` treated "one string
 * contains the other" as a match, so "2" matched "12". The brain never
 * compares strings. It extracts one number from Wolfram's result, and the
 * two-engine runner compares numbers with the exam.yaml tolerance.
 *
 * Outcomes: `value`, or `no_result` / `unavailable` / `quota`. None of the
 * last three is ever a disagreement (plan §7 WolframUnavailable).
 */

export type WolframOutcome =
  | { kind: 'value'; value: number; pod: string; plaintext: string }
  | { kind: 'no_result'; detail: string }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'quota'; detail: string };

export interface WolframOptions {
  appId: string | undefined;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface Pod {
  id: string;
  title?: string;
  subpods?: { plaintext?: string }[];
}
interface Response {
  queryresult?: { success?: boolean; error?: boolean | { msg?: string }; pods?: Pod[] };
}

const POD_ORDER = ['DecimalApproximation', 'Result', 'Solution', 'ExactResult', 'RealSolution'];

/** Parse one number from Wolfram plaintext: "0.75", "-2.5", "3/4", "1.23×10^-5", "≈1.414…". */
export function parseWolframNumber(text: string): number | undefined {
  let s = text.trim().replace(/^[≈~=]\s*/, '').replace(/(\.\.\.|…)$/, '').replace(/−/g, '-').replace(/\s+/g, '');
  if (s.includes('=') || s.includes(',')) return undefined; // several values or an equation: not one number
  const sci = /^([+-]?\d*\.?\d+)×10\^\(?([+-]?\d+)\)?$/.exec(s);
  if (sci) return Number(sci[1]) * 10 ** Number(sci[2]);
  const frac = /^([+-]?\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[2]) === 0 ? undefined : Number(frac[1]) / Number(frac[2]);
  s = s.replace(/^\+/, '');
  if (/^[-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  return undefined;
}

export async function wolframValue(query: string, opts: WolframOptions): Promise<WolframOutcome> {
  if (!opts.appId) return { kind: 'unavailable', detail: 'WOLFRAM_APP_ID not set' };
  const f = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({ input: query, appid: opts.appId, format: 'plaintext', output: 'json' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let body: Response;
  try {
    const res = await f(`${opts.endpoint ?? 'https://api.wolframalpha.com/v2/query'}?${params}`, { signal: controller.signal });
    if (res.status === 429) return { kind: 'quota', detail: 'HTTP 429' };
    if (!res.ok) return { kind: 'unavailable', detail: `HTTP ${res.status}` };
    body = (await res.json()) as Response;
  } catch (e) {
    return { kind: 'unavailable', detail: e instanceof Error ? e.message : 'network error' };
  } finally {
    clearTimeout(timer);
  }
  const qr = body.queryresult;
  if (!qr) return { kind: 'unavailable', detail: 'malformed response' };
  if (qr.error) {
    const msg = typeof qr.error === 'object' ? qr.error.msg ?? 'error' : 'error';
    return /limit|quota|exceeded/i.test(msg) ? { kind: 'quota', detail: msg } : { kind: 'unavailable', detail: msg };
  }
  if (!qr.success) return { kind: 'no_result', detail: 'Wolfram could not interpret the query' };
  const pods = qr.pods ?? [];
  for (const id of POD_ORDER) {
    const pod = pods.find((p) => p.id === id);
    const text = pod?.subpods?.[0]?.plaintext;
    if (!text) continue;
    const v = parseWolframNumber(text);
    if (v !== undefined && Number.isFinite(v)) return { kind: 'value', value: v, pod: id, plaintext: text };
  }
  return { kind: 'no_result', detail: 'no single numeric result pod' };
}
