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
];
