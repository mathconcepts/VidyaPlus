#!/usr/bin/env python3
"""Vidhya sync applier (plan §4 S-sync, R2, R9, R20).

ONE file. It runs INSIDE the DeepTutor container (`docker exec -i <c> python
<this file>`) and uses DeepTutor's own pinned store code (PracticeStore,
initialize_practice, importing.normalize_question, SQLiteSessionStore). It
receives FINISHED rows from the brain-side `vidhya sync` command (D1): it never
computes a fingerprint or a ledger tag, it only stores what it was given.

Protocol: one JSON object on stdin, one JSON object on stdout.

  {"mode": "apply" | "dry-run" | "users",
   "data_root": "/app/data",
   "expected_version": "1.7.3",
   "events_path": "/app/data/vidhya/events.jsonl",
   "lock_path": "/app/data/vidhya/sync.lock",
   "update_mode": "in-place" | "delete-insert",     # R9, falls back to R2
   "allow_mass_remove": false,
   "students": [{"student": "<label>", "dt_user_id": "u_...",
                 "rows": [{"id": "gate-ec-001", "tag": "ledger:gate-ec-001@ab12cd34",
                           "question": "...", "question_type": "single_choice|multi_choice",
                           "options": {"A": "..", ...}, "correct_answer": "B" | "A,C",
                           "explanation": "...", "difficulty": "", "tags": ["topic"]}]}]}

Output: {"ok": bool, "error": null | {"code", "message"}, "students": [...]}.
Exit status: 0 ok, 1 some student failed/skipped, 3 SyncAlreadyRunning,
4 StoreSchemaMismatch, 5 other run-level error.

Guarantees:
  * flock on lock_path (non-blocking): a second run -> SyncAlreadyRunning.
  * schema guard: every target DB is checked BEFORE any write; a mismatch aborts
    the whole run (StoreSchemaMismatch).
  * per student: ONE `BEGIN IMMEDIATE` transaction; any error rolls it back and
    leaves the bank exactly as it was.
  * lock wait > 5 s -> SyncLockTimeout, student skipped, retried next run.
  * > 20 % of a bank removed -> SyncMassRemoveRefused unless allow_mass_remove.
  * review events of removed items are appended to events.jsonl BEFORE the
    delete, idempotently on DeepTutor's request_id (R20), before commit.
  * changed items are UPDATEd in place (R9): same row id, review state kept,
    version bumped by DeepTutor's own `practice_invalidate_question` trigger.
"""

from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

ORIGIN_TYPE = "external_import"
ORIGIN_REF = "vidhya-sync"  # own namespace: student-imported questions are never touched
MATERIAL_TITLE = "Vidhya"
TAG_RE = re.compile(r"^ledger:([A-Za-z0-9][A-Za-z0-9._-]*)@([0-9a-f]{8})$")
MASS_REMOVE_FRACTION = 0.20
LOCK_WAIT_MS = 5000

REQUIRED_NOTEBOOK_COLUMNS = {
    "id", "origin_type", "origin_ref", "turn_id", "question_id", "question", "question_type",
    "options_json", "correct_answer", "explanation", "difficulty", "user_answer", "source",
    "result", "assessment_type", "created_at", "updated_at", "material_title", "material_id",
}


class SyncError(Exception):
    code = "SyncError"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class SyncAlreadyRunning(SyncError):
    code = "SyncAlreadyRunning"


class StoreSchemaMismatch(SyncError):
    code = "StoreSchemaMismatch"


class SyncMassRemoveRefused(SyncError):
    code = "SyncMassRemoveRefused"


class SyncLockTimeout(SyncError):
    code = "SyncLockTimeout"


class SyncPartialFailure(SyncError):
    code = "SyncPartialFailure"


# --------------------------------------------------------------------------- paths


def student_db_path(data_root: Path, dt_user_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", dt_user_id or ""):
        raise SyncError(f"unsafe DeepTutor user id: {dt_user_id!r}", "InvalidStudent")
    return data_root / "users" / dt_user_id / "user" / "chat_history.db"


def list_user_ids(data_root: Path) -> list[str]:
    root = data_root / "users"
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if (p / "user" / "chat_history.db").exists())


# ------------------------------------------------------------------- DeepTutor glue


def _deeptutor():
    """Import DeepTutor's own store code. Fails loudly if the layout moved."""
    root = os.environ.get("DEEPTUTOR_ROOT", "/app")
    if root not in sys.path:
        sys.path.append(root)  # the script dir, not the cwd, is on sys.path under `python <file>`
    try:
        from deeptutor.__version__ import __version__
        from deeptutor.services.practice.importing import normalize_question
        from deeptutor.services.practice.storage import PracticeStore, initialize_practice
    except Exception as exc:  # noqa: BLE001 - any import failure means the pinned code is not what we expect
        raise StoreSchemaMismatch(f"cannot import DeepTutor's practice store: {exc}") from exc
    return __version__, normalize_question, PracticeStore, initialize_practice


def check_schema(conn: sqlite3.Connection, where: str) -> None:
    """The store layout this applier was written against (pinned 1.7.3)."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(notebook_entries)")}
    missing = REQUIRED_NOTEBOOK_COLUMNS - cols
    if missing:
        raise StoreSchemaMismatch(f"{where}: notebook_entries lacks {sorted(missing)}")
    for table, pk in (("practice_review_state", "entry_id"), ("practice_review_events", "request_id")):
        info = conn.execute(f"PRAGMA table_info({table})").fetchall()  # nosec B608 - fixed names
        if not info or not any(r[1] == pk and r[5] == 1 for r in info):
            raise StoreSchemaMismatch(f"{where}: {table} is missing or its primary key moved")
    ev_cols = {r[1] for r in conn.execute("PRAGMA table_info(practice_review_events)")}
    if not {"request_id", "entry_id", "rating", "answer", "reviewed_at", "outcome_json"} <= ev_cols:
        raise StoreSchemaMismatch(f"{where}: practice_review_events columns changed")
    for table in ("notebook_categories", "notebook_entry_categories"):
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            raise StoreSchemaMismatch(f"{where}: table {table} is missing")
    trig = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='practice_invalidate_question'"
    ).fetchone()
    flat = re.sub(r"\s+", " ", (trig[0] if trig else "") or "").lower()
    if not trig or "update of question, options_json, correct_answer on notebook_entries" not in flat \
            or "set version=version+1" not in flat.replace(" = ", "=").replace("version = version + 1", "version=version+1"):
        raise StoreSchemaMismatch(f"{where}: trigger practice_invalidate_question is missing or changed")
    # The uniqueness the in-place path relies on (R9): (origin_type, origin_ref, turn_id, question_id).
    unique_cols = []
    for idx in conn.execute("PRAGMA index_list(notebook_entries)").fetchall():
        if idx[2]:
            unique_cols.append([r[2] for r in conn.execute(f"PRAGMA index_info('{idx[1]}')")])  # nosec B608
    if ["origin_type", "origin_ref", "turn_id", "question_id"] not in unique_cols:
        raise StoreSchemaMismatch(f"{where}: the unique key on notebook_entries moved: {unique_cols}")


def _open_readonly(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=LOCK_WAIT_MS / 1000)
    conn.row_factory = sqlite3.Row
    return conn


# ------------------------------------------------------------------------ the bank


def read_bank(conn: sqlite3.Connection) -> dict[str, dict]:
    """ledger id -> {entry_id, fp8, tag, question_id} for this student's vidhya-sync entries."""
    bank: dict[str, dict] = {}
    rows = conn.execute(
        """SELECT n.id AS entry_id, n.question_id, c.name AS tag
           FROM notebook_entries n
           JOIN notebook_entry_categories ec ON ec.entry_id = n.id
           JOIN notebook_categories c ON c.id = ec.category_id
           WHERE n.origin_type = ? AND n.origin_ref = ? AND n.turn_id = '' AND c.name LIKE 'ledger:%'""",
        (ORIGIN_TYPE, ORIGIN_REF),
    ).fetchall()
    for r in rows:
        m = TAG_RE.match(r["tag"])
        if not m:
            continue
        lid, fp8 = m.group(1), m.group(2)
        if lid in bank and bank[lid]["entry_id"] != r["entry_id"]:
            raise SyncPartialFailure(f"two entries carry the ledger id {lid}")
        bank[lid] = {"entry_id": r["entry_id"], "fp8": fp8, "tag": r["tag"], "question_id": r["question_id"]}
    # An entry in our namespace without a ledger tag is not ours to reason about; leave it.
    return bank


def plan_for(bank: dict[str, dict], rows: dict[str, dict]) -> dict:
    insert = sorted(i for i in rows if i not in bank)
    remove = sorted(i for i in bank if i not in rows)
    update = sorted(i for i in rows if i in bank and bank[i]["fp8"] != _fp8_of(rows[i]))
    unchanged = len(rows) - len(insert) - len(update)
    return {"insert": insert, "update": update, "remove": remove, "unchanged": unchanged}


def _fp8_of(row: dict) -> str:
    m = TAG_RE.match(row["tag"])
    if not m or m.group(1) != row["id"]:
        raise SyncError(f"row {row.get('id')!r} has a malformed or mismatched tag {row.get('tag')!r}", "InvalidRow")
    return m.group(2)


def check_mass_remove(existing: int, removing: int, allow: bool) -> None:
    if allow or existing == 0 or removing == 0:
        return
    if removing / existing > MASS_REMOVE_FRACTION:
        raise SyncMassRemoveRefused(
            f"would remove {removing} of {existing} items (> {int(MASS_REMOVE_FRACTION * 100)}%); "
            "re-run with --allow-mass-remove if this is intended"
        )


# ------------------------------------------------------------------------ events.jsonl (R20)


def load_event_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                ids.add(json.loads(line)["request_id"])
            except (ValueError, KeyError):
                continue  # a torn last line from a killed run; the event is re-captured next run
    return ids


def append_events(path: Path, events: list[dict]) -> int:
    """Append only events whose request_id is not already present. fsync before returning."""
    if not events:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    seen = load_event_ids(path)
    fresh = []
    for e in events:
        if e["request_id"] in seen:
            continue
        seen.add(e["request_id"])
        fresh.append(e)
    if not fresh:
        return 0
    with path.open("a", encoding="utf-8") as fh:
        for e in fresh:
            fh.write(json.dumps(e, ensure_ascii=False, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return len(fresh)


def capture_events(conn: sqlite3.Connection, student: str, entries: dict[str, dict]) -> list[dict]:
    out = []
    for lid, info in entries.items():
        for r in conn.execute(
            "SELECT request_id, entry_id, rating, answer, reviewed_at, outcome_json "
            "FROM practice_review_events WHERE entry_id = ? ORDER BY reviewed_at",
            (info["entry_id"],),
        ):
            out.append({
                "request_id": r["request_id"], "student": student, "ledger_id": lid,
                "item_fp8": info["fp8"], "rating": r["rating"], "answer": r["answer"],
                "reviewed_at": r["reviewed_at"], "outcome": json.loads(r["outcome_json"]),
                "source": "sync-capture",
            })
    return out


# --------------------------------------------------------------------- fault injection


def _fault(point: str) -> None:
    """Test hook only: VIDHYA_SYNC_TEST_FAULT=<point> hard-kills the process like SIGKILL."""
    if os.environ.get("VIDHYA_SYNC_TEST_FAULT") == point:
        os._exit(137)


def _raise_fault(point: str) -> None:
    if os.environ.get("VIDHYA_SYNC_TEST_RAISE") == point:
        raise sqlite3.OperationalError(f"injected failure at {point}")


# ---------------------------------------------------------------------------- apply


def _native(normalize_question, row: dict) -> dict:
    q = normalize_question({
        "question": row["question"], "question_type": row["question_type"], "options": row["options"],
        "correct_answer": row["correct_answer"], "explanation": row.get("explanation", ""),
        "difficulty": row.get("difficulty", ""), "tags": [row["tag"], *row.get("tags", [])],
    })
    return q


def _set_tags(conn: sqlite3.Connection, entry_id: int, tags: list[str], now: float) -> None:
    for tag in tags:
        conn.execute("INSERT OR IGNORE INTO notebook_categories(name, created_at) VALUES(?, ?)", (tag, now))
        conn.execute(
            "INSERT OR IGNORE INTO notebook_entry_categories(entry_id, category_id) "
            "SELECT ?, id FROM notebook_categories WHERE name=?",
            (entry_id, tag),
        )


def apply_student(PracticeStore, normalize_question, db_path: Path, student: str, rows: dict[str, dict],
                  events_path: Path, update_mode: str, allow_mass: bool, dry_run: bool) -> dict:
    result = {"student": student, "status": "ok", "inserted": 0, "updated": 0, "deleted": 0,
              "unchanged": 0, "events_captured": 0}
    # Normalise through DeepTutor's own code first: bad rows fail before we touch anything.
    native = {lid: _native(normalize_question, r) for lid, r in rows.items()}

    if not db_path.exists():
        bank: dict[str, dict] = {}
    else:
        ro = _open_readonly(db_path)
        try:
            bank = read_bank(ro)
        finally:
            ro.close()
    plan = plan_for(bank, rows)
    result.update(plan_insert=len(plan["insert"]), plan_update=len(plan["update"]),
                  plan_remove=len(plan["remove"]), unchanged=plan["unchanged"])
    check_mass_remove(len(bank), len(plan["remove"]), allow_mass)
    if dry_run:
        result["status"] = "dry-run"
        return result
    if not (plan["insert"] or plan["update"] or plan["remove"]):
        return result

    store = PracticeStore(db_path)
    now = time.time()
    try:
        with store.connect() as conn:
            conn.execute(f"PRAGMA busy_timeout = {LOCK_WAIT_MS}")
            try:
                conn.execute("BEGIN IMMEDIATE")
            except sqlite3.OperationalError as exc:
                if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                    raise SyncLockTimeout(f"{student}: store locked for > {LOCK_WAIT_MS // 1000}s") from exc
                raise
            # Re-read inside the lock: DeepTutor may have written since the dry read.
            bank = read_bank(conn)
            plan = plan_for(bank, rows)
            check_mass_remove(len(bank), len(plan["remove"]), allow_mass)

            replace_ids = list(plan["update"]) if update_mode == "delete-insert" else []
            doomed = {lid: bank[lid] for lid in [*plan["remove"], *replace_ids]}
            events = capture_events(conn, student, doomed)
            # R20: events reach events.jsonl BEFORE the delete and before commit; idempotent on request_id.
            result["events_captured"] = append_events(events_path, events)
            _fault("after-events")

            # 1. changed items, in place (R9)
            if update_mode == "in-place":
                for lid in plan["update"]:
                    q, e = native[lid], bank[lid]
                    conn.execute(
                        "UPDATE notebook_entries SET question=?, question_type=?, options_json=?, correct_answer=?, "
                        "explanation=?, difficulty=?, question_id=?, updated_at=? WHERE id=?",
                        (q["question"], q["question_type"], json.dumps(q["options"], ensure_ascii=False),
                         q["correct_answer"], q["explanation"], q["difficulty"], q["question_id"], now, e["entry_id"]),
                    )
                    conn.execute(
                        "DELETE FROM notebook_entry_categories WHERE entry_id=? AND category_id IN "
                        "(SELECT id FROM notebook_categories WHERE name LIKE 'ledger:%')",
                        (e["entry_id"],),
                    )
                    _set_tags(conn, e["entry_id"], q["tags"], now)
                    result["updated"] += 1
                    _raise_fault_after_first_write()
            # 2. removed (and, in fallback mode, changed) items: delete; cascades clear review rows
            for lid in [*plan["remove"], *replace_ids]:
                conn.execute("DELETE FROM notebook_entries WHERE id=?", (bank[lid]["entry_id"],))
                if lid in plan["remove"]:
                    result["deleted"] += 1
            _fault("after-delete")
            # 3. new rows (and re-inserts in fallback mode)
            for lid in [*plan["insert"], *replace_ids]:
                q = native[lid]
                cur = conn.execute(
                    """INSERT INTO notebook_entries(
                        session_id, origin_type, origin_ref, question_id, question, question_type,
                        options_json, correct_answer, explanation, difficulty, user_answer, source,
                        result, assessment_type, created_at, updated_at, material_title, material_id)
                       VALUES(NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'import', 'ungraded', 'quiz', ?, ?, ?, ?)""",
                    (ORIGIN_TYPE, ORIGIN_REF, q["question_id"], q["question"], q["question_type"],
                     json.dumps(q["options"], ensure_ascii=False), q["correct_answer"], q["explanation"],
                     q["difficulty"], now, now, MATERIAL_TITLE, "vidhya-sync"),
                )
                _set_tags(conn, cur.lastrowid, q["tags"], now)
                if lid in plan["insert"]:
                    result["inserted"] += 1
                else:
                    result["updated"] += 1
            # drop ledger tag categories nothing points at any more
            conn.execute(
                "DELETE FROM notebook_categories WHERE name LIKE 'ledger:%' AND id NOT IN "
                "(SELECT category_id FROM notebook_entry_categories)"
            )
            # 5. verify inside the transaction; a mismatch rolls everything back
            after = read_bank(conn)
            if set(after) != set(rows) or any(after[i]["fp8"] != _fp8_of(rows[i]) for i in rows):
                raise SyncPartialFailure(f"{student}: bank does not match the servable set after apply")
            dup = conn.execute(
                "SELECT COUNT(*) - COUNT(DISTINCT question_id) FROM notebook_entries WHERE origin_type=? AND origin_ref=?",
                (ORIGIN_TYPE, ORIGIN_REF),
            ).fetchone()[0]
            if dup:
                raise SyncPartialFailure(f"{student}: duplicate rows for one ledger id after apply")
            _fault("before-commit")
            _raise_fault("before-commit")
            # leaving the `with store.connect()` block commits (DeepTutor's own context manager)
    except SyncError:
        raise
    except sqlite3.OperationalError as exc:
        if "locked" in str(exc).lower() or "busy" in str(exc).lower():
            raise SyncLockTimeout(f"{student}: {exc}") from exc
        raise SyncPartialFailure(f"{student}: store error, rolled back: {exc}") from exc
    except sqlite3.Error as exc:
        raise SyncPartialFailure(f"{student}: store error, rolled back: {exc}") from exc
    return result


_first_write_done = False


def _raise_fault_after_first_write() -> None:
    global _first_write_done
    if not _first_write_done:
        _first_write_done = True
        _fault("after-first-write")


# ------------------------------------------------------------------------------ main


def run(req: dict) -> tuple[dict, int]:
    mode = req.get("mode", "apply")
    data_root = Path(req.get("data_root", "/app/data"))
    if mode == "users":
        return {"ok": True, "error": None, "users": list_user_ids(data_root)}, 0

    if mode == "apply" and os.geteuid() == 0 and not os.environ.get("VIDHYA_SYNC_ALLOW_ROOT"):
        # A root-owned store directory or WAL file would lock DeepTutor (uid 1000) out of the student's DB.
        raise SyncError("run the applier as DeepTutor's runtime user (docker exec -u deeptutor), not root", "InvalidRequest")
    version, normalize_question, PracticeStore, initialize_practice = _deeptutor()
    expected = req.get("expected_version")
    if expected and version != expected:
        raise StoreSchemaMismatch(f"DeepTutor is {version}, this sync is pinned to {expected}")

    events_path = Path(req.get("events_path", str(data_root / "vidhya" / "events.jsonl")))
    lock_path = Path(req.get("lock_path", str(data_root / "vidhya" / "sync.lock")))
    update_mode = req.get("update_mode", "in-place")
    if update_mode not in ("in-place", "delete-insert"):
        raise SyncError(f"unknown update_mode {update_mode!r}", "InvalidRequest")
    allow_mass = bool(req.get("allow_mass_remove"))
    dry = mode == "dry-run"
    students = req.get("students", [])

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_fh = open(lock_path, "a+")  # noqa: SIM115 - held for the whole run
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        raise SyncAlreadyRunning(f"another sync holds {lock_path}") from exc

    try:
        # Schema guard for EVERY target before any write.
        targets = []
        for s in students:
            path = student_db_path(data_root, s["dt_user_id"])
            if path.exists():
                ro = _open_readonly(path)
                try:
                    check_schema(ro, s["student"])
                finally:
                    ro.close()
            targets.append((s, path))

        out, failed = [], False
        for s, path in targets:
            rows = {r["id"]: r for r in s["rows"]}
            if len(rows) != len(s["rows"]):
                out.append({"student": s["student"], "status": "failed", "error": {
                    "code": "InvalidRow", "message": "duplicate ledger ids in the rows"}})
                failed = True
                continue
            if not path.exists():
                if dry:
                    pass
                else:
                    # A student who never opened practice has no store yet: DeepTutor creates it.
                    from deeptutor.services.session.sqlite_store import SQLiteSessionStore
                    SQLiteSessionStore(db_path=path)
                    ro = _open_readonly(path)
                    try:
                        check_schema(ro, s["student"])
                    finally:
                        ro.close()
            try:
                out.append(apply_student(PracticeStore, normalize_question, path, s["student"], rows,
                                         events_path, update_mode, allow_mass, dry))
            except SyncError as exc:
                failed = True
                out.append({"student": s["student"], "status": "skipped" if isinstance(exc, SyncLockTimeout) else "failed",
                            "error": {"code": exc.code, "message": str(exc)}})
        return {"ok": not failed, "error": None, "mode": mode, "update_mode": update_mode, "students": out}, (1 if failed else 0)
    finally:
        fcntl.flock(lock_fh, fcntl.LOCK_UN)
        lock_fh.close()


def main() -> int:
    try:
        req = json.load(sys.stdin)
        body, code = run(req)
    except SyncAlreadyRunning as exc:
        body, code = {"ok": False, "error": {"code": exc.code, "message": str(exc)}, "students": []}, 3
    except StoreSchemaMismatch as exc:
        body, code = {"ok": False, "error": {"code": exc.code, "message": str(exc)}, "students": []}, 4
    except SyncError as exc:
        body, code = {"ok": False, "error": {"code": exc.code, "message": str(exc)}, "students": []}, 5
    json.dump(body, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
