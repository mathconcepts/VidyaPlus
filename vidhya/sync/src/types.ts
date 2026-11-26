import type { Item } from '../../brain/src/item/schema.js';

export type SyncType = 'MCQ' | 'MSQ';

/** The query the brain's GET /v1/servable?pool=practice&type=MCQ,MSQ answers. */
export interface ServableQuery {
  pool: 'practice';
  types: readonly SyncType[];
  /** `--to <version>`: the pack version the caller expects the brain to be serving. */
  version?: string;
}

/**
 * Assumed /v1/servable body (the HTTP server is built elsewhere): the release
 * items that are verified and not in the status overlay, with their keys.
 * The route is loopback/bearer only, never the student-facing surface.
 */
export interface ServableResponse {
  pack_version: string;
  items: Item[];
}

export interface ServableSource {
  fetch(q: ServableQuery): Promise<{ packVersion: string; items: Item[] }>;
}

/** A finished row for DeepTutor's store. The applier stores it; it never recomputes the tag. */
export interface SyncRow {
  id: string;
  tag: string;
  question: string;
  question_type: 'single_choice' | 'multi_choice';
  options: Record<string, string>;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  tags: string[];
}

export interface StudentRef {
  /** Label used in logs and events.jsonl (a hash, never a name). */
  student: string;
  /** DeepTutor's user id (the directory under data/users/). */
  dtUserId: string;
}

export type UpdateMode = 'in-place' | 'delete-insert';

export interface ApplierRequest {
  mode: 'apply' | 'dry-run' | 'users';
  data_root?: string;
  expected_version?: string;
  events_path?: string;
  lock_path?: string;
  update_mode?: UpdateMode;
  allow_mass_remove?: boolean;
  students?: { student: string; dt_user_id: string; rows: SyncRow[] }[];
}

export interface ApplierStudentResult {
  student: string;
  status: 'ok' | 'dry-run' | 'skipped' | 'failed';
  inserted?: number;
  updated?: number;
  deleted?: number;
  unchanged?: number;
  events_captured?: number;
  plan_insert?: number;
  plan_update?: number;
  plan_remove?: number;
  error?: { code: string; message: string };
}

export interface ApplierResponse {
  ok: boolean;
  error: { code: string; message: string } | null;
  students?: ApplierStudentResult[];
  users?: string[];
  mode?: string;
  update_mode?: string;
}

/** How the in-container applier is reached: `docker exec` in production, a fake in unit tests. */
export interface ApplierRunner {
  run(req: ApplierRequest): Promise<{ code: number; body: ApplierResponse }>;
}
