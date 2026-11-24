import { describe, it, expect, vi } from 'vitest';
import { initTheme, applyTheme } from './theme';

function fakeWin(initial: boolean) {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = {
    matches: initial,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => { listener = l; },
    removeEventListener: vi.fn(() => { listener = null; }),
  };
  return { win: { matchMedia: () => mql } as unknown as Window, fire: (matches: boolean) => listener?.({ matches }), mql };
}

describe('theme (DR20)', () => {
  it('sets data-theme from prefers-color-scheme at start', () => {
    const root = document.createElement('div');
    initTheme(fakeWin(true).win, root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    initTheme(fakeWin(false).win, root);
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('follows later changes and stops when told to', () => {
    const root = document.createElement('div');
    const f = fakeWin(false);
    const stop = initTheme(f.win, root);
    f.fire(true);
    expect(root.getAttribute('data-theme')).toBe('dark');
    f.fire(false);
    expect(root.getAttribute('data-theme')).toBe('light');
    stop();
    expect(f.mql.removeEventListener).toHaveBeenCalled();
  });

  it('falls back to light without matchMedia', () => {
    const root = document.createElement('div');
    initTheme({} as Window, root);
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('applyTheme writes the attribute', () => {
    const root = document.createElement('div');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
  });
});
