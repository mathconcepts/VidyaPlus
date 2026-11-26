import { createRoot } from 'react-dom/client';
import { DemoRoot } from './DemoRoot';

/** Demo entry. Only reachable through main.tsx's `import.meta.env.MODE === 'demo'` branch. */
export function mountDemo(el: HTMLElement): void {
  createRoot(el).render(<DemoRoot />);
}
