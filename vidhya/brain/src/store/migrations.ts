/**
 * B3 schema (plan §4 B3, §15 S7). Forward-only; a backup is taken before each
 * migration in production (plan §14). Every attempt carries the item's
 * fingerprint and pack version, so an errata never silently re-grades history.
 */
export const MIGRATIONS: readonly { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: '001_core',
    sql: `
CREATE TABLE attempts (
  id              INTEGER PRIMARY KEY,
  idempotency_key TEXT    NOT NULL UNIQUE,
  student_hash    TEXT    NOT NULL,
  item_id         TEXT    NOT NULL,
  fingerprint     TEXT    NOT NULL,
  pack_version    TEXT    NOT NULL,
  context         TEXT    NOT NULL CHECK (context IN ('practice','mock','diagnostic','ledger')),
  response_json   TEXT    NOT NULL,
  correct         INTEGER NOT NULL CHECK (correct IN (0,1)),
  skipped         INTEGER NOT NULL CHECK (skipped IN (0,1)),
  marks_awarded   REAL    NOT NULL,
  marks_max       REAL    NOT NULL,
  elapsed_ms      INTEGER,
  source          TEXT    NOT NULL CHECK (source IN ('brain','ledger-sync')),
  ts              TEXT    NOT NULL
);
CREATE INDEX attempts_student_ts ON attempts (student_hash, ts);
CREATE INDEX attempts_item_fp    ON attempts (item_id, fingerprint);

-- The live status overlay (plan §3): servable = release verified minus these rows.
CREATE TABLE item_status (
  item_id     TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('disputed','quarantined')),
  reason      TEXT NOT NULL,
  since       TEXT NOT NULL,
  closed_at   TEXT,
  closed_by_release TEXT,
  PRIMARY KEY (item_id, fingerprint, since)
);
CREATE INDEX item_status_item ON item_status (item_id);

CREATE TABLE disputes (
  id            INTEGER PRIMARY KEY,
  item_id       TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  student_hash  TEXT,                 -- NULL for anonymous MCP reports (Giri's queue only, O2)
  channel       TEXT NOT NULL CHECK (channel IN ('exam','mcp')),
  note          TEXT CHECK (note IS NULL OR length(note) <= 280),
  day           TEXT NOT NULL,        -- YYYY-MM-DD, for the 3/day cap and the storm rule
  counted       INTEGER NOT NULL CHECK (counted IN (0,1)),
  state         TEXT NOT NULL CHECK (state IN ('open','hidden_for_reporter','giri_queue','logged_only','quarantined','resolved_cleared','resolved_retired')),
  created_at    TEXT NOT NULL
);
CREATE INDEX disputes_item_day ON disputes (item_id, day);
CREATE UNIQUE INDEX disputes_one_per_student_item ON disputes (student_hash, item_id, fingerprint) WHERE student_hash IS NOT NULL;

CREATE TABLE item_stats (
  item_id        TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  n              INTEGER NOT NULL,
  p_correct      REAL,
  median_ms      INTEGER,
  discrimination REAL,
  computed_at    TEXT NOT NULL,
  PRIMARY KEY (item_id, fingerprint)
);

CREATE TABLE plans (
  id           INTEGER PRIMARY KEY,
  student_hash TEXT NOT NULL,
  day          TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  plan_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX plans_student_day ON plans (student_hash, day);

CREATE TABLE mocks (
  id            INTEGER PRIMARY KEY,
  student_hash  TEXT NOT NULL,
  form_version  TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('in_progress','scored','practice_only')),
  started_at    TEXT NOT NULL,
  deadline_at   TEXT NOT NULL,
  submitted_at  TEXT,
  score         REAL,
  result_json   TEXT
);
-- One scored attempt per student per form (plan B5, §15 S1 state machine).
CREATE UNIQUE INDEX mocks_one_scored ON mocks (student_hash, form_version) WHERE state IN ('in_progress','scored');
`,
  },
  {
    version: 2,
    name: '002_registry',
    sql: `
-- R23 / X4: who a student is (hashed), their tier, and how long access lasts.
-- Raw Telegram ids and DeepTutor user ids are never stored, only hashes.
CREATE TABLE registry (
  student_hash   TEXT PRIMARY KEY,
  dt_user_hash   TEXT NOT NULL UNIQUE,
  tier           TEXT NOT NULL,
  entitled_until TEXT CHECK (entitled_until IS NULL OR entitled_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
`,
  },
  {
    version: 3,
    name: '003_overlay_audit',
    sql: `
-- B6: every overlay change leaves an append-only audit row (no UPDATE, no DELETE).
CREATE TABLE overlay_audit (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('quarantine_quorum','quarantine_admin','restore_admin')),
  actor       TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX overlay_audit_item ON overlay_audit (item_id);
CREATE TRIGGER overlay_audit_no_update BEFORE UPDATE ON overlay_audit
BEGIN SELECT RAISE(ABORT, 'overlay_audit is append-only'); END;
CREATE TRIGGER overlay_audit_no_delete BEFORE DELETE ON overlay_audit
BEGIN SELECT RAISE(ABORT, 'overlay_audit is append-only'); END;
`,
  },
  {
    version: 4,
    name: '004_mock',
    sql: `
-- B5 / R15 / R21: the one fixed mock form, its attempts, server-side autosave and an audit trail.
-- The 'mocks' table from 001 stays the attempt table: state in_progress|scored is the scored
-- attempt (one per student per form version), practice_only is any later or post-close attempt.
CREATE TABLE mock_forms (
  form_version  TEXT PRIMARY KEY,
  minutes       INTEGER NOT NULL CHECK (minutes > 0),
  total_marks   REAL    NOT NULL CHECK (total_marks > 0),
  items_json    TEXT    NOT NULL,   -- frozen [{item_id, fingerprint, grading_fp, marks}] in form order
  planned_close TEXT CHECK (planned_close IS NULL OR planned_close GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  registered_at TEXT NOT NULL,
  closed_at     TEXT,               -- set by 'vidhya mock close'; keys, solutions and receipts unlock then
  closed_by     TEXT
);
ALTER TABLE mocks ADD COLUMN minutes INTEGER;
ALTER TABLE mocks ADD COLUMN items_json TEXT;   -- the form's items, frozen at start
ALTER TABLE mocks ADD COLUMN submit_reason TEXT CHECK (submit_reason IS NULL OR submit_reason IN ('submit','auto'));
CREATE INDEX mocks_student_form ON mocks (student_hash, form_version);

-- R21: every answer is persisted on entry. Append-only; the latest client_entered_at per item wins.
CREATE TABLE mock_answers (
  id                INTEGER PRIMARY KEY,
  mock_id           INTEGER NOT NULL REFERENCES mocks(id),
  item_id           TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  response_json     TEXT NOT NULL,
  client_entered_at TEXT NOT NULL,
  received_at       TEXT NOT NULL,
  late_sync         INTEGER NOT NULL CHECK (late_sync IN (0,1)),   -- E3
  queue_owner       TEXT NOT NULL,                                 -- E7
  UNIQUE (mock_id, item_id, idempotency_key)
);
CREATE INDEX mock_answers_mock_item ON mock_answers (mock_id, item_id);

-- R21: resets and closes are audited, append-only (no UPDATE, no DELETE).
CREATE TABLE mock_audit (
  id           INTEGER PRIMARY KEY,
  ts           TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('reset','close')),
  form_version TEXT NOT NULL,
  student_hash TEXT,
  mock_id      INTEGER,
  actor        TEXT NOT NULL,
  reason       TEXT,
  detail       TEXT
);
CREATE TRIGGER mock_audit_no_update BEFORE UPDATE ON mock_audit
BEGIN SELECT RAISE(ABORT, 'mock_audit is append-only'); END;
CREATE TRIGGER mock_audit_no_delete BEFORE DELETE ON mock_audit
BEGIN SELECT RAISE(ABORT, 'mock_audit is append-only'); END;
`,
  },
  {
    version: 5,
    name: '005_http_and_dispute_fix',
    sql: `
-- Gap (a): a report filed during the mock (queue only, counted = 0) used to hold the one
-- unique slot per (student, item, fingerprint), so the same student's later counted dispute
-- on that item was refused as a duplicate. Uniqueness now applies per kind of row.
DROP INDEX disputes_one_per_student_item;
CREATE UNIQUE INDEX disputes_one_counted_per_student_item ON disputes (student_hash, item_id, fingerprint)
  WHERE student_hash IS NOT NULL AND counted = 1;
CREATE UNIQUE INDEX disputes_one_queued_per_student_item ON disputes (student_hash, item_id, fingerprint)
  WHERE student_hash IS NOT NULL AND state = 'giri_queue';

-- E12: the server records when it SERVED a practice item; a late answer is judged by that time.
CREATE TABLE practice_serves (
  id           INTEGER PRIMARY KEY,
  student_hash TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  served_at    TEXT NOT NULL
);
CREATE INDEX practice_serves_student_item ON practice_serves (student_hash, item_id, served_at);

-- DR5: the student's "flag for later" mark on a mock answer.
ALTER TABLE mock_answers ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0,1));
`,
  },
  {
    version: 6,
    name: '006_rendered_items',
    sql: `
-- E5 / E8: KaTeX HTML rendered once per item version at sync, never per request.
-- Keyed by (fingerprint, katex_version): an errata changes the fingerprint and a
-- KaTeX upgrade changes the version, so either one re-renders automatically.
-- status 'failed' means the item is unservable (no raw TeX is ever served instead).
CREATE TABLE rendered_items (
  fingerprint   TEXT NOT NULL,
  katex_version TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ok','failed')),
  html_json     TEXT,                 -- {stem, options[], solution}; NULL when failed
  error_code    TEXT,                 -- RenderFailed | RenderUnsafe when failed
  error_message TEXT,
  rendered_at   TEXT NOT NULL,
  PRIMARY KEY (fingerprint, katex_version),
  CHECK ((status = 'ok' AND html_json IS NOT NULL) OR (status = 'failed' AND html_json IS NULL AND error_code IS NOT NULL))
);
CREATE INDEX rendered_items_item ON rendered_items (item_id);
`,
  },
];
