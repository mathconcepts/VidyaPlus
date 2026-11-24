import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** jsdom has no matchMedia. This stub answers min-width queries for the given viewport width. */
export function setViewport(width: number, dark = false): void {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : /prefers-color-scheme:\s*dark/.test(query) ? dark : false;
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

export const renderAt = (ui: ReactElement, width = 360) => { setViewport(width); return render(ui); };
