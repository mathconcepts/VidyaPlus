import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runMigrations } from '../../store/migrate.js';
import { MOCK_ITEMS, PRACTICE, TIERS } from '../../http/__tests__/harness.js';
import { GATE_LIKE } from '../../scoring/__tests__/fixtures.js';
import type { Item } from '../../item/schema.js';

export async function runMigrationsForTest(db: string, backupDir: string): Promise<void> {
  await runMigrations(db, { backupDir });
}

/** Writes a synthetic pack release (items.jsonl + exam.json). */
export function writePackDir(dir: string, mockItems: Item[] = MOCK_ITEMS): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'items.jsonl'), [...PRACTICE, ...mockItems].map((i) => JSON.stringify(i)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'exam.json'), JSON.stringify({
    version: 'pack-test-1', marking: GATE_LIKE, timing: { total_minutes: 180, total_marks: 100 },
    topics: [{ id: 't1', label: 'Linear algebra', weight_marks: 6 }], tiers: TIERS,
    mock: { form_version: 'f1', opens_on: '2026-12-13', closes_on: '2026-12-20', planned_close: '2026-12-20' },
  }));
}
