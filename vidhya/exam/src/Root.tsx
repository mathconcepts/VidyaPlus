import { useEffect, useState } from 'react';
import { App, type AppProps } from './App';
import type { ExamApi } from './api/types';
import type { HttpExamApi } from './api/http';

/** Wires the API's build-mismatch signal (E10) to the shell's refresh banner. */
export function Root({ api, ...rest }: { api: ExamApi | HttpExamApi } & Omit<AppProps, 'api'>) {
  const [release, setRelease] = useState(false);
  useEffect(() => ('onBuildMismatch' in api ? api.onBuildMismatch(() => setRelease(true)) : undefined), [api]);
  return <App api={api} releaseAvailable={release || rest.releaseAvailable} {...rest} />;
}
