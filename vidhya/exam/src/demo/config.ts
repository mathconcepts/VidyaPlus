/** The demo's switchable states. Held in the URL hash so a link can open any state, and never stored anywhere else. */
export type MockState = 'before-open' | 'not-started' | 'in-progress' | 'last-minutes' | 'time-up' | 'closed-taker' | 'closed-practice';
export type TodayState = 'starter' | 'estimate' | 'cleared';
export type MarksState = 'needs-more' | 'low-n' | 'full';
export type ThemeChoice = 'auto' | 'light' | 'dark';

export interface DemoConfig {
  mock: MockState;
  today: TodayState;
  marks: MarksState;
  theme: ThemeChoice;
  /** The brain is unreachable: every call fails and the outage banner shows (DR8). */
  outage: boolean;
  /** Answers are held on the device and checked later (DR5). */
  offline: boolean;
  /** Access ended (DR7): Today and new items lock. */
  accessEnded: boolean;
  /** The "Content updated, refresh" banner (E10), shown on request only. */
  release: boolean;
}

export const DEFAULTS: DemoConfig = { mock: 'not-started', today: 'starter', marks: 'full', theme: 'auto', outage: false, offline: false, accessEnded: false, release: false };

export const MOCK_LABELS: Record<MockState, string> = {
  'before-open': 'Not open yet',
  'not-started': 'Open, not started',
  'in-progress': 'In progress (37 min left, 7 answered)',
  'last-minutes': 'In progress (4 min left)',
  'time-up': 'Time ran out: result before close',
  'closed-taker': 'Closed: review for takers',
  'closed-practice': 'Closed: practice mock, unscored',
};
export const TODAY_LABELS: Record<TodayState, string> = { starter: 'Starter plan', estimate: 'Plan with marks estimate', cleared: 'All cleared' };
export const MARKS_LABELS: Record<MarksState, string> = { 'needs-more': 'Needs more attempts', 'low-n': 'Few attempts (wide range)', full: 'Range and taxonomy' };

const BOOL_KEYS = ['outage', 'offline', 'accessEnded', 'release'] as const;

export function parseConfig(hash: string): DemoConfig {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const pick = <T extends string>(k: string, allowed: Record<T, unknown>, d: T): T => { const v = p.get(k); return v && v in allowed ? (v as T) : d; };
  const c: DemoConfig = {
    mock: pick('mock', MOCK_LABELS, DEFAULTS.mock),
    today: pick('today', TODAY_LABELS, DEFAULTS.today),
    marks: pick('marks', MARKS_LABELS, DEFAULTS.marks),
    theme: pick('theme', { auto: 1, light: 1, dark: 1 }, DEFAULTS.theme),
    outage: false, offline: false, accessEnded: false, release: false,
  };
  for (const k of BOOL_KEYS) c[k] = p.get(k) === '1';
  return c;
}

export function configToHash(c: DemoConfig): string {
  const p = new URLSearchParams();
  (['mock', 'today', 'marks', 'theme'] as const).forEach(k => { if (c[k] !== DEFAULTS[k]) p.set(k, c[k]); });
  BOOL_KEYS.forEach(k => { if (c[k]) p.set(k, '1'); });
  const s = p.toString();
  return s ? `#${s}` : '';
}
