import { openStore, type Db } from '../../store/db.js';
import { hashId, upsertStudent } from '../../registry/registry.js';
import { GATE_LIKE } from '../../scoring/__tests__/fixtures.js';
import type { Item } from '../../item/schema.js';
import type { MockContext } from '../rows.js';
import { registerForm } from '../attempts.js';

/** Synthetic only: no real items, names or phone numbers. */
export const T0 = new Date('2026-12-13T09:00:00Z');
export const min = (n: number) => n * 60_000;
export const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

export const SECRET_KEY_TEXT = 'SENTINEL-SOLUTION-TEXT';
export const SECRET_RECEIPT = { engine: 'SENTINEL-RECEIPT', verified: true };

const base = (o: Partial<Item> & Pick<Item, 'id' | 'type' | 'key' | 'marks'>): Item => ({
  pool: 'mock', answer_kind: o.type === 'NAT' ? 'number' : 'options', topic_id: 'topic-secret', concept_id: 'concept-secret',
  stem: `Synthetic stem ${o.id}`, solution: { text: `${SECRET_KEY_TEXT} ${o.id}`, checked: true },
  receipt: SECRET_RECEIPT, status: 'verified', since_version: 'v0', ...o,
});

export const ITEMS: Item[] = [
  base({ id: 'm1', type: 'MCQ', marks: 1, options: ['a', 'b', 'c', 'd'], key: 1 }),
  base({ id: 'm2', type: 'MCQ', marks: 2, options: ['a', 'b', 'c', 'd'], key: 2 }),
  base({ id: 'm3', type: 'MSQ', marks: 2, options: ['a', 'b', 'c', 'd'], key: [0, 3] }),
  base({ id: 'm4', type: 'NAT', marks: 1, key: '2', nat_range: [1.9, 2.1] }),
];
// total 6 marks; with 180 min / 100 marks => 10.8 -> 11 minutes
export const TIMING = { total_minutes: 180, total_marks: 100 };
export const FORM_MINUTES = 11;

export const S1 = hashId('syn-student-1', 'salt');
export const S2 = hashId('syn-student-2', 'salt');
export const S3 = hashId('syn-student-3', 'salt');

export interface World {
  db: Db;
  ctx: MockContext;
  items: Map<string, Item>;
}

export function world(opts: { entitled_until?: string | null } = {}): World {
  const db = openStore(':memory:');
  const items = new Map(ITEMS.map((i) => [i.id, i]));
  const ctx: MockContext = { marking: GATE_LIKE, resolveItem: (id) => items.get(id) };
  for (const [n, s] of [[1, S1], [2, S2], [3, S3]] as const) {
    upsertStudent(db, { student_hash: s, dt_user_hash: hashId(`syn-dt-${n}`, 'salt'), tier: 'pilot', entitled_until: opts.entitled_until === undefined ? '2026-12-31' : opts.entitled_until }, T0);
  }
  registerForm(db, { form_version: 'f1', items: ITEMS, timing: TIMING, planned_close: '2026-12-20' }, T0);
  return { db, ctx, items };
}

let seq = 0;
export const meta = (student: string, received: Date, entered: Date = received, key?: string) => ({
  idempotencyKey: key ?? `k${++seq}`, receivedAt: received, clientEnteredAt: entered, queueOwner: student,
});
export const mcq = (i: number) => ({ kind: 'mcq' as const, selectedIndex: i });
export const msq = (is: number[]) => ({ kind: 'msq' as const, selectedIndices: is });
export const nat = (v: number) => ({ kind: 'nat' as const, value: v });
