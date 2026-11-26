import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { receiptFromItemRecord } from '@vidhya/ui/lib/receipt';
import { App } from '../App';
import { setViewport } from '../test-utils';
import { DemoExamApi } from './DemoApi';
import { DEFAULTS, configToHash, parseConfig } from './config';
import { MOCK_ITEMS, PRACTICE_ITEMS } from './items.generated';

const api = (over = {}) => new DemoExamApi({ ...DEFAULTS, ...over });

describe('demo data', () => {
  it('items.generated.ts matches the source (regenerate with npm run gen:demo -w exam)', () => {
    const bin = path.resolve(__dirname, '../../../node_modules/.bin/vite-node');
    execFileSync(bin, [path.resolve(__dirname, '../../scripts/gen-demo-items.ts'), '--check'], { stdio: 'pipe' });
  }, 60_000);

  it('practice covers MCQ, MSQ and NAT with KaTeX-rendered maths', async () => {
    const a = api();
    const today = await a.getToday();
    expect(new Set(today.items.map(i => i.kind))).toEqual(new Set(['mcq', 'msq', 'nat']));
    for (const ref of today.items) expect((await a.getItem(ref.id)).stemHtml).toContain('class="katex"');
  });

  it('every verified item carries a record whose fingerprint matches (receipt law)', async () => {
    const a = api();
    for (const it of PRACTICE_ITEMS.filter(i => i.verification === 'verified')) {
      const item = await a.getItem(it.id);
      expect(item.verification.state).toBe('verified');
      if (item.verification.state === 'verified') {
        expect(receiptFromItemRecord({ status: 'verified', source: item.verification.source, recordFingerprint: item.verification.recordFingerprint }, item.fingerprint)).not.toBeNull();
      }
    }
  });

  it('the mock is 18 items and 30 marks, with a computed key for each', () => {
    expect(MOCK_ITEMS).toHaveLength(18);
    expect(MOCK_ITEMS.reduce((n, i) => n + i.marks, 0)).toBe(30);
    for (const it of MOCK_ITEMS) expect(it.key).toMatch(/^[A-D](,[A-D])*$|^-?\d+(\.\d+)?$/);
  });

  it('marks states: needs-more has no range; full shows Unclassified', async () => {
    expect((await api({ marks: 'needs-more' }).getMarks()).range).toBeNull();
    const full = await api({ marks: 'full' }).getMarks();
    expect(full.taxonomy?.some(t => t.bucket === 'UNCLASSIFIED')).toBe(true);
  });

  it('time-up answers the mock before close with a tally; closed-taker has a review', async () => {
    const t = api({ mock: 'time-up' });
    const at = await t.startMock();
    expect(at.deadlineMs - at.serverNowMs).toBe(0);
    const r = await t.getMockResult();
    expect(r.right + r.wrong + r.skipped).toBe(18);
    const rev = await api({ mock: 'closed-taker' }).getMockReview();
    expect(rev).toHaveLength(18);
  });

  it('outage makes every call fail as "down"', async () => {
    await expect(api({ outage: true }).getToday()).rejects.toMatchObject({ down: true });
  });

  it('offline holds an answer and releases it when back online', async () => {
    const a = api({ offline: true });
    const seen: number[] = [];
    const got: string[] = [];
    a.onWaiting((n) => seen.push(n));
    a.onQueuedResult(r => got.push(r.outcome));
    expect(await a.checkAnswer('demo-023', { kind: 'nat', raw: '3' })).toEqual({ status: 'queued' });
    a.setOnline(true);
    expect(got).toEqual(['correct']);
    expect(seen.at(-1)).toBe(0);
  });

  it('the hash round-trips and ignores junk', () => {
    const c = parseConfig('#mock=closed-taker&marks=low-n&theme=dark&outage=1&bogus=1');
    expect(c).toMatchObject({ mock: 'closed-taker', marks: 'low-n', theme: 'dark', outage: true });
    expect(parseConfig(configToHash(c))).toEqual(c);
    expect(parseConfig('#mock=nope').mock).toBe(DEFAULTS.mock);
  });
});

describe('the app on the demo API', () => {
  it('Today renders and a practice item opens', async () => {
    setViewport(360);
    render(<App api={api()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/eigenvalues of/i)).toBeInTheDocument();
  });
});
