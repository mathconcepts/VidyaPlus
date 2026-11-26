import type { ExamApi } from './types';
import { HttpExamApi } from './http';

declare const __BUILD_ID__: string;

/**
 * Which ExamApi the app runs on. `import.meta.env.DEV` is a build-time constant, so in a production
 * build the branch that can reach FakeExamApi is removed: a student can never land on synthetic data,
 * not even with ?fake=1. In dev, `?fake=1` opts in to the fake; otherwise dev talks to the brain too.
 */
export async function chooseApi(search: string = typeof location === 'undefined' ? '' : location.search): Promise<ExamApi> {
  if (import.meta.env.DEV && new URLSearchParams(search).get('fake') === '1') return new (await import('./fake')).FakeExamApi();
  const api = new HttpExamApi({ buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : undefined });
  void api.init().catch(() => undefined); // learns the student id for the offline queue; a 401 redirects to login
  return api;
}
