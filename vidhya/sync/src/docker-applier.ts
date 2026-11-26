import { spawn } from 'node:child_process';
import { SyncError } from './errors.js';
import type { ApplierRequest, ApplierResponse, ApplierRunner } from './types.js';

/**
 * Runs the applier inside the DeepTutor container:
 *   docker exec -i -u deeptutor -w /app <container> python <script>   (request on stdin, JSON on stdout)
 * `dockerCmd` can be ["sudo","docker"]. The script path is the path INSIDE the container.
 */
export class DockerExecRunner implements ApplierRunner {
  constructor(
    private readonly container: string,
    private readonly script = '/vidhya-sync/applier/vidhya_sync_applier.py',
    private readonly dockerCmd: readonly string[] = ['docker'],
    private readonly env: Record<string, string> = {},
    /** DeepTutor's runtime user. Never root: a root-written store would lock the app out of the student's DB. */
    private readonly user = 'deeptutor',
  ) {}

  run(req: ApplierRequest): Promise<{ code: number; body: ApplierResponse }> {
    const [bin, ...pre] = this.dockerCmd;
    const envArgs = Object.entries(this.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const args = [...pre, 'exec', '-i', '-u', this.user, '-w', '/app', ...envArgs, this.container, 'python', this.script];
    return new Promise((resolve, reject) => {
      const p = spawn(bin!, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => reject(new SyncError('ApplierFailed', `cannot start docker: ${e.message}`)));
      p.on('close', (code) => {
        const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
        try {
          resolve({ code: code ?? 5, body: JSON.parse(line) as ApplierResponse });
        } catch {
          reject(new SyncError('ApplierFailed', `applier exited ${code} without a JSON answer: ${(err || out).slice(0, 400)}`));
        }
      });
      p.stdin.end(JSON.stringify(req));
    });
  }
}
