import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

// axe probes canvas for ligature icons; jsdom has none. A null context makes it skip that check quietly.
HTMLCanvasElement.prototype.getContext = (() => null) as never;
