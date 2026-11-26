import type { Db } from '../store/db.js';
import type { Pack } from '../pack/pack.js';
import type { MockContext } from '../mock/rows.js';
import { entitledAt, flagsFor, getStudent, type Flags } from '../registry/registry.js';
import { BrainError } from '../errors.js';
import { fingerprint, type Item } from '../item/schema.js';
import { getRenderedItem, isRenderable, type RenderedItem } from '../render/index.js';

/** What every service function needs. Time is always passed in, never read here. */
export interface Deps {
  db: Db;
  pack: Pack;
  mockCtx: MockContext;
}

export function makeDeps(db: Db, pack: Pack): Deps {
  return {
    db,
    pack,
    mockCtx: { marking: pack.marking, tiers: pack.tiers, resolveItem: (id) => pack.byId.get(id) },
  };
}

export function flagsOf(d: Deps, student: string, now: Date): Flags {
  return flagsFor(getStudent(d.db, student), now, d.pack.tiers);
}

export function isEntitled(d: Deps, student: string, now: Date): boolean {
  return entitledAt(getStudent(d.db, student), now);
}

/** New work (serving an item, a plan, a report) needs entitlement and the named flag (DR7, X4). */
export function requireFlag(d: Deps, student: string, now: Date, flag: keyof Flags): void {
  const row = getStudent(d.db, student);
  if (!entitledAt(row, now)) throw new BrainError('AccessEnded', 'access has ended; history stays readable, new work is off');
  if (!flagsFor(row, now, d.pack.tiers)[flag]) throw new BrainError('FeatureNotEnabled', `${flag} is not enabled for this account`);
}

/** True when this exact item version has stored, cleaned HTML. An item that is not is not servable (E5). */
export function renderable(d: Deps, item: Item): boolean {
  return isRenderable(d.db, fingerprint(item));
}

/** The stored HTML for an item, or RenderFailed / RenderMissing. Raw item text is never a fallback. */
export function renderedOf(d: Deps, item: Item): RenderedItem {
  return getRenderedItem(d.db, fingerprint(item));
}
