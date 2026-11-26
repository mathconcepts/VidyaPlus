/**
 * The sync command's read of the pack (vidhya/sync): the practice items DeepTutor's Practice may hold,
 * WITH their keys. This is the one place keys leave the brain outside a student's own check, which is why
 * the route (src/http/internal.ts) is bearer-only and loopback/internal-only, and why it can never return
 * a mock-pool item: the pool is checked here, not trusted from the caller.
 */
import { BrainError } from '../errors.js';
import { isServable, type Item } from '../item/schema.js';
import { openOverlayRows } from '../disputes/disputes.js';
import type { Deps } from './deps.js';

const TYPES = ['MCQ', 'MSQ', 'NAT'] as const;

export interface ServableBody {
  pack_version: string;
  items: Item[];
}

export function servableForSync(d: Deps, q: { pool: string | null; type: string | null; version: string | null }): ServableBody {
  if (q.pool !== 'practice') throw new BrainError('BadRequest', 'pool must be "practice"; no other pool is ever served here');
  const types = (q.type ?? 'MCQ,MSQ').split(',').map((t) => t.trim()).filter(Boolean);
  if (types.length === 0 || types.some((t) => !(TYPES as readonly string[]).includes(t))) throw new BrainError('BadRequest', `type must be a comma list of ${TYPES.join(', ')}`);
  if (q.version && q.version !== d.pack.version) {
    throw new BrainError('PackVersionMismatch', `the brain is serving pack ${d.pack.version}, not ${q.version}`);
  }
  const overlay = openOverlayRows(d.db);
  const items = d.pack.items.filter((i) => i.pool === 'practice' && types.includes(i.type) && isServable(i, overlay));
  return { pack_version: d.pack.version, items };
}
