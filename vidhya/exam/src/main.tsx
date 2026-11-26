import './theme-boot';
import './styles/entry.css';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { chooseApi } from './api/choose';
import { loadKatexCssWhenIdle } from './lib/katex-css';

// Production always talks to the brain. The fake exists for dev and tests only (see api/choose.ts).
void chooseApi().then(api => createRoot(document.getElementById('root')!).render(<Root api={api} />));
loadKatexCssWhenIdle();
