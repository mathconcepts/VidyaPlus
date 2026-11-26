/**
 * KaTeX CSS and fonts load lazily (E5, E11): the build emits them under /exam/katex/ (see vite.config.ts)
 * and this adds the stylesheet once, after the first screen has painted. Plain-text items never need it
 * and the 250 KB first-load budget does not count it (the budget script counts what index.html references).
 */
let added = false;
export function loadKatexCss(base: string = import.meta.env.BASE_URL): void {
  if (added || typeof document === 'undefined') return;
  added = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${base}katex/katex.min.css`;
  document.head.appendChild(link);
}

/** Schedules `loadKatexCss` for when the browser is idle after load. */
export function loadKatexCssWhenIdle(): void {
  if (typeof window === 'undefined') return;
  const go = () => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (ric) ric(() => loadKatexCss()); else setTimeout(() => loadKatexCss(), 200);
  };
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
