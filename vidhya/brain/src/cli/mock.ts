/**
 * `vidhya mock close <form_version>` and `vidhya mock reset <student_hash> --reason <text>`.
 * Both are audited in mock_audit by src/mock/close.ts. The actor is VIDHYA_ACTOR (or --actor).
 * Needs VIDHYA_DB and PACK_DIR (or --db, --pack). Never migrates: an old schema is refused.
 */
import { isBrainError, BrainError } from '../errors.js';
import { closeMock, resetAttempt } from '../mock/close.js';
import { openRuntime, type Env } from '../runtime.js';
import { parseArgs } from './args.js';

const USAGE = `usage:
  vidhya mock close <form_version> [--actor <name>]
  vidhya mock reset <student_hash> --reason <text> [--form <form_version>] [--minutes <n>] [--actor <name>]
common: --db <file> --pack <dir> (or VIDHYA_DB, PACK_DIR)`;

export function runMockCli(argv: string[], env: Env = process.env, out: (s: string) => void = console.log, err: (s: string) => void = console.error, now: () => Date = () => new Date()): number {
  let p;
  try {
    p = parseArgs(argv);
  } catch (e) {
    err((e as Error).message);
    err(USAGE);
    return 1;
  }
  const [sub, arg] = p.pos;
  if ((sub !== 'close' && sub !== 'reset') || !arg || p.pos.length > 2) {
    err(USAGE);
    return 1;
  }
  try {
    const actor = p.flags.actor ?? env.VIDHYA_ACTOR ?? 'cli-admin';
    if (sub === 'reset') {
      // R21: a reset is only for an attempt an outage covered, and says why. The reason text is the record.
      const reason = p.flags.reason?.trim();
      if (!reason) throw new BrainError('InvalidMockRequest', 'a reset needs --reason <what outage covered this attempt>');
      if (!/^[0-9a-f]{64}$/.test(arg)) throw new BrainError('InvalidMockRequest', 'student_hash must be the 64-hex student hash');
    }
    const rt = openRuntime(env, { db: p.flags.db, pack: p.flags.pack });
    try {
      if (sub === 'close') {
        out(JSON.stringify(closeMock(rt.db, rt.deps.mockCtx, arg, actor, now())));
      } else {
        const form = p.flags.form ?? rt.pack.mock?.form_version;
        if (!form) throw new BrainError('InvalidMockRequest', 'no --form given and the pack has no mock');
        const minutes = p.flags.minutes === undefined ? undefined : Number(p.flags.minutes);
        out(JSON.stringify(resetAttempt(rt.db, rt.deps.mockCtx, { student: arg, form_version: form, reason: p.flags.reason!, actor, minutes }, now())));
      }
      return 0;
    } finally {
      rt.db.close();
    }
  } catch (e) {
    err(`mock ${sub} failed (${isBrainError(e) ? e.code : 'Unexpected'}): ${(e as Error).message}`);
    return 1;
  }
}
