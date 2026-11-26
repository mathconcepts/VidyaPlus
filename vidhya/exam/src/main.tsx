import './theme-boot';
import './styles/entry.css';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { chooseApi } from './api/choose';
import { loadKatexCssWhenIdle } from './lib/katex-css';

if (import.meta.env.MODE === 'demo') {
  // Static look-and-feel build (`npm run build:demo`): synthetic data, no backend. `MODE` is a build-time
  // constant, so a production build removes this branch and the whole src/demo/ folder with it.
  void import('./demo/mount').then(m => m.mountDemo(document.getElementById('root')!));
} else {
  // Production always talks to the brain. The fake exists for dev and tests only (see api/choose.ts).
  void chooseApi().then(api => createRoot(document.getElementById('root')!).render(<Root api={api} />));
}
loadKatexCssWhenIdle();
