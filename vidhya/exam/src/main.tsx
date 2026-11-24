import './theme-boot';
import './styles/entry.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FakeExamApi } from './api/fake';

// Real HTTP comes later behind the same ExamApi interface.
createRoot(document.getElementById('root')!).render(<App api={new FakeExamApi()} />);
