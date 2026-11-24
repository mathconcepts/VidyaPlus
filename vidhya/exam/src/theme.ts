/**
 * Dark mode (DR20, T36). An external module, never an inline script, so the
 * /exam CSP can stay `script-src 'self'` (E8). It sets `data-theme` on <html>
 * from `prefers-color-scheme` and follows later changes; Clarity's
 * `[data-theme="dark"]` tokens do the rest.
 */
export type Theme = 'light' | 'dark';

const QUERY = '(prefers-color-scheme: dark)';

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
}

/** Applies the current scheme and keeps following it. Returns a function that stops following. */
export function initTheme(
  win: Pick<Window, 'matchMedia'> = window,
  root: HTMLElement = document.documentElement,
): () => void {
  if (typeof win.matchMedia !== 'function') {
    applyTheme('light', root);
    return () => {};
  }
  const mql = win.matchMedia(QUERY);
  applyTheme(mql.matches ? 'dark' : 'light', root);
  const onChange = (e: { matches: boolean }) => applyTheme(e.matches ? 'dark' : 'light', root);
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  // Older Safari.
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}
