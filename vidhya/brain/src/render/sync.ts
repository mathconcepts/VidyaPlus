/**
 * Sync hook and lookup for rendered items (plan E5). `renderOnSync` renders only
 * missing (fingerprint, katex_version) rows. A failure is recorded and makes the
 * item unservable by name; raw TeX is never served as a fallback.
 */
import type Database from 'better-sqlite3';
import { BrainError, isBrainError } from '../errors.js';
import { fingerprint, type Item } from '../item/schema.js';
import { KATEX_VERSION, renderItemMath, type RenderedItem } from './katex.js';

type Db = Database.Database;

export interface RenderSyncResult {
  rendered: string[];
  skipped: string[];
  failed: { item_id: string; code: 'RenderFailed' | 'RenderUnsafe'; message: string }[];
}

interface Row {
  status: 'ok' | 'failed';
  html_json: string | null;
  error_code: string | null;
  error_message: string | null;
}

export function renderOnSync(db: Db, items: readonly Item[], opts: { katexVersion?: string; now?: Date } = {}): RenderSyncResult {
  const version = opts.katexVersion ?? KATEX_VERSION;
  const ts = (opts.now ?? new Date()).toISOString();
  const get = db.prepare('SELECT status FROM rendered_items WHERE fingerprint = ? AND katex_version = ?');
  const put = db.prepare(
    `INSERT INTO rendered_items (fingerprint, katex_version, item_id, status, html_json, error_code, error_message, rendered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (fingerprint, katex_version) DO UPDATE SET item_id = excluded.item_id, status = excluded.status,
       html_json = excluded.html_json, error_code = excluded.error_code, error_message = excluded.error_message, rendered_at = excluded.rendered_at`,
  );
  const result: RenderSyncResult = { rendered: [], skipped: [], failed: [] };
  for (const item of items) {
    const fp = fingerprint(item);
    const existing = get.get(fp, version) as { status: string } | undefined;
    if (existing?.status === 'ok') {
      result.skipped.push(item.id);
      continue;
    }
    try {
      const html = renderItemMath(item);
      put.run(fp, version, item.id, 'ok', JSON.stringify(html), null, null, ts);
      result.rendered.push(item.id);
    } catch (e) {
      if (!isBrainError(e, 'RenderFailed') && !isBrainError(e, 'RenderUnsafe')) throw e;
      const code = (e as BrainError).code as 'RenderFailed' | 'RenderUnsafe';
      put.run(fp, version, item.id, 'failed', null, code, e.message, ts);
      result.failed.push({ item_id: item.id, code, message: e.message });
    }
  }
  return result;
}

/**
 * The stored HTML for an item version. Throws RenderFailed for an item whose render failed
 * (unservable) and RenderMissing when it was never rendered at this KaTeX version.
 */
export function getRenderedItem(db: Db, fp: string, opts: { katexVersion?: string } = {}): RenderedItem {
  const row = db
    .prepare('SELECT status, html_json, error_code, error_message FROM rendered_items WHERE fingerprint = ? AND katex_version = ?')
    .get(fp, opts.katexVersion ?? KATEX_VERSION) as Row | undefined;
  if (!row) throw new BrainError('RenderMissing', `no rendered HTML for ${fp.slice(0, 8)} at KaTeX ${opts.katexVersion ?? KATEX_VERSION}; run sync`);
  if (row.status === 'failed') throw new BrainError('RenderFailed', row.error_message ?? 'render failed');
  return JSON.parse(row.html_json!) as RenderedItem;
}

/** True only when the item version has stored, cleaned HTML. The serve path ANDs this with isServable. */
export function isRenderable(db: Db, fp: string, opts: { katexVersion?: string } = {}): boolean {
  const row = db
    .prepare('SELECT status FROM rendered_items WHERE fingerprint = ? AND katex_version = ?')
    .get(fp, opts.katexVersion ?? KATEX_VERSION) as { status: string } | undefined;
  return row?.status === 'ok';
}
