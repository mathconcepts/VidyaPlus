import { useEffect, useRef, useState } from 'react';

/** matchMedia with a safe fallback (jsdom has none). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

/**
 * Seconds left on the SERVER clock. `serverNowMs` is the server's time when the
 * data was fetched and `deadlineMs` is the server deadline; the device clock is
 * never read, so changing it cannot buy time. Re-syncs when either prop changes.
 */
export function useServerCountdown(serverNowMs: number, deadlineMs: number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [serverNowMs, deadlineMs]);
  return Math.max(0, Math.floor((deadlineMs - serverNowMs) / 1000) - elapsed);
}

/** Moves focus to the returned ref's element whenever `trigger` becomes truthy (DR17: after Check, focus the result line). */
export function useFocusOn<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (trigger) ref.current?.focus();
  }, [trigger]);
  return ref;
}
