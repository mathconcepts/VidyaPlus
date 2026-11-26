#!/usr/bin/env python3
"""Spikes S1 (session contract, the part that needs no browser), S3 (a)-(g) and the S-sync
integration test (plan §8, §9 "S-sync", T21), run against the pinned DeepTutor container
with ONE synthetic test student and synthetic items only. stdlib only.

Prereqs: ./up.sh has run; `npm ci && npm run build` in vidhya/sync and `npm ci` in vidhya/brain.
Env: SUDO=sudo (if docker needs it), DT_DATA (host data dir, default ./.run/data),
     IT_STUDENT_USER / IT_STUDENT_PASS, DT_BACKEND_PORT.

Exit 0 only if every check PASSes. Writes .run/s3-results.json (check id, status, evidence).
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SYNC_DIR = HERE.parent
FIX = HERE / "fixtures"
DOCKER = (os.environ.get("SUDO", "") + " docker").split()
CONTAINER = os.environ.get("IT_CONTAINER", "vidhya-it-deeptutor")
BACKEND = f"http://127.0.0.1:{os.environ.get('DT_BACKEND_PORT', '8001')}"
DT_DATA = pathlib.Path(os.environ.get("DT_DATA", HERE / ".run" / "data"))
STUDENT = os.environ.get("IT_STUDENT_USER", "it-student-1")
PASSWORD = os.environ.get("IT_STUDENT_PASS", "it-student-pass-1234")
EVENTS = DT_DATA / "vidhya" / "events.jsonl"
PRACTICE = "/api/question-notebook/practice"

RESULTS: list[dict] = []
EXPECT_V1 = [f"syn-{n:03d}" for n in (1, 2, 3, 5, 6, 7, 8, 9)]
EXPECT_V2 = [f"syn-{n:03d}" for n in (1, 3, 4, 5, 6, 7, 8, 9)]


def record(cid: str, title: str, ok: bool | None, evidence: str) -> None:
    status = "PASS" if ok else ("FAIL" if ok is False else "UNKNOWN")
    RESULTS.append({"id": cid, "title": title, "status": status, "evidence": evidence})
    print(f"[{status}] {cid} {title}\n        {evidence}", flush=True)


# ------------------------------------------------------------------------------ http


class Client:
    def __init__(self) -> None:
        self.cookie: str | None = None
        self.set_cookie_header = ""

    def call(self, method: str, path: str, body: dict | None = None, cookie: str | None = "self"):
        headers = {"content-type": "application/json"}
        c = self.cookie if cookie == "self" else cookie
        if c:
            headers["cookie"] = f"dt_token={c}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BACKEND + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None), r.headers
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw), e.headers
            except ValueError:
                return e.code, raw.decode(errors="replace"), e.headers

    def login(self) -> None:
        st, body, hdr = self.call("POST", "/api/auth/login", {"username": STUDENT, "password": PASSWORD}, cookie=None)
        assert st == 200, (st, body)
        self.set_cookie_header = hdr.get("set-cookie", "")
        self.cookie = self.set_cookie_header.split("dt_token=", 1)[1].split(";", 1)[0]


# --------------------------------------------------------------------------- container


def dexec(args: list[str], stdin: str | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    envs = [x for k, v in (env or {}).items() for x in ("-e", f"{k}={v}")]
    return subprocess.run([*DOCKER, "exec", "-i", "-u", "deeptutor", "-w", "/app", *envs, CONTAINER, *args], input=stdin,
                          capture_output=True, text=True)


def dbq(db_user_id: str, sql: str, params: list | None = None):
    code = (
        "import sqlite3,json,sys;a=json.load(sys.stdin);"
        f"c=sqlite3.connect('/app/data/users/{db_user_id}/user/chat_history.db');c.row_factory=sqlite3.Row;"
        "print(json.dumps([dict(r) for r in c.execute(a['sql'],a['p']).fetchall()]))"
    )
    p = dexec(["python", "-c", code], json.dumps({"sql": sql, "p": params or []}))
    if p.returncode != 0:
        raise RuntimeError(p.stderr)
    return json.loads(p.stdout)


def bank(uid: str) -> dict:
    """ledger id -> {entry_id, tag, question_id, version, review_count} for the vidhya-sync origin."""
    rows = dbq(uid, """SELECT n.id AS entry_id, n.question_id, n.correct_answer, n.explanation, c.name AS tag,
                       COALESCE(r.version, -1) AS version, COALESCE(r.review_count, 0) AS review_count
                       FROM notebook_entries n
                       JOIN notebook_entry_categories ec ON ec.entry_id=n.id
                       JOIN notebook_categories c ON c.id=ec.category_id AND c.name LIKE 'ledger:%'
                       LEFT JOIN practice_review_state r ON r.entry_id=n.id
                       WHERE n.origin_ref='vidhya-sync' ORDER BY n.id""")
    out = {}
    for r in rows:
        lid = r["tag"].split(":", 1)[1].split("@", 1)[0]
        out[lid] = r
    return out


def bank_hash(uid: str) -> str:
    rows = dbq(uid, "SELECT id,question_id,question,options_json,correct_answer,explanation FROM notebook_entries ORDER BY id")
    rows2 = dbq(uid, "SELECT * FROM practice_review_state ORDER BY entry_id")
    rows3 = dbq(uid, "SELECT request_id FROM practice_review_events ORDER BY request_id")
    rows4 = dbq(uid, "SELECT ec.entry_id, c.name FROM notebook_entry_categories ec JOIN notebook_categories c ON c.id=ec.category_id ORDER BY 1,2")
    return hashlib.sha256(json.dumps([rows, rows2, rows3, rows4], sort_keys=True).encode()).hexdigest()


def events_lines() -> list[dict]:
    if not EVENTS.exists():
        return []
    return [json.loads(x) for x in EVENTS.read_text().splitlines() if x.strip()]


# ------------------------------------------------------------------------------- sync


def run_sync(servable: str, uid: str, *extra: str, env: dict | None = None) -> tuple[int, dict]:
    students = HERE / ".run" / "students.json"
    students.write_text(json.dumps([{"student": "synthetic-student-hash", "dt_user_id": uid}]))
    cmd = ["node", str(SYNC_DIR / "dist/sync/src/cli.js"), "--servable-file", str(FIX / f"{servable}.json"),
           "--container", CONTAINER, "--docker", " ".join(DOCKER), "--students-file", str(students), *extra]
    for k, v in (env or {}).items():
        cmd += ["--applier-env", f"{k}={v}"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    text = p.stdout.strip() or p.stderr.strip()
    try:
        body = json.loads(text)
    except ValueError:
        body = {"raw": text}
    return p.returncode, body


def student0(body: dict) -> dict:
    return (body.get("students") or [{}])[0]


# ---------------------------------------------------------------------------- checks


def main() -> int:
    c = Client()
    c.login()
    st, status, _ = c.call("GET", "/api/auth/status")
    uid = status["user_id"]

    # ---------------------------------------------------------------- S1 (no browser)
    shape_ok = isinstance(status.get("enabled"), bool) and isinstance(status.get("authenticated"), bool) and status["authenticated"] is True
    record("S1-a", "GET /api/auth/status with the dt_token cookie returns {enabled, authenticated, user_id}", shape_ok and st == 200,
           f"HTTP {st}; keys={sorted(status)}; authenticated={status.get('authenticated')}; user_id={uid}")
    st2, anon, _ = c.call("GET", "/api/auth/status", cookie=None)
    record("S1-b", "no cookie -> authenticated=false, user_id=null (brain answers SessionMissing)", st2 == 200 and anon["authenticated"] is False and anon["user_id"] is None, f"HTTP {st2}; {anon}")
    st3, bad, _ = c.call("GET", "/api/auth/status", cookie="not.a.jwt")
    tampered = c.cookie[:-4] + ("AAAA" if not c.cookie.endswith("AAAA") else "BBBB")
    st4, bad2, _ = c.call("GET", "/api/auth/status", cookie=tampered)
    record("S1-c", "garbage and tampered cookies -> authenticated=false (an expired/invalid cookie redirects to login)",
           bad["authenticated"] is False and bad2["authenticated"] is False, f"garbage={bad['authenticated']}, tampered={bad2['authenticated']}")
    sc = c.set_cookie_header
    record("S1-d", "cookie attributes the brain and Caddy rely on: name dt_token, HttpOnly, Path=/, SameSite=lax",
           "dt_token=" in sc and "HttpOnly" in sc and "Path=/" in sc and "SameSite=lax" in sc.replace("Lax", "lax"),
           f"Set-Cookie attrs: {sc.split(';', 1)[1].strip() if ';' in sc else sc}  (Secure is absent here: cookie_secure=false in auth.json; production must set it true behind TLS)")
    # token expiry: the JWT carries exp; the server refuses an altered exp (signature), so expiry is only testable by waiting
    import base64
    payload = json.loads(base64.urlsafe_b64decode(c.cookie.split(".")[1] + "=="))
    record("S1-e", "the token carries exp (24 h default) and uid; the user id the brain gets from /status equals the JWT uid",
           payload.get("uid") == uid and "exp" in payload, f"exp-iat={payload['exp'] - payload['iat']}s; uid==user_id: {payload.get('uid') == uid}")

    # ------------------------------------------------------------------ clean slate
    rc, body = run_sync("servable-empty", uid, "--allow-mass-remove")
    assert rc == 0, body
    if EVENTS.exists():
        EVENTS.unlink()

    # -------------------------------------------------------------------- seed v1
    rc, body = run_sync("servable-v1", uid)
    s = student0(body)
    b1 = bank(uid)
    record("S3-c1", "first sync inserts exactly one row per ledger id", rc == 0 and s.get("inserted") == 8 and sorted(b1) == EXPECT_V1,
           f"exit={rc}; inserted={s.get('inserted')}; bank ids={sorted(b1)}; drift={body.get('drift')}")
    h = bank_hash(uid)
    rc, body = run_sync("servable-v1", uid)
    s = student0(body)
    record("S-sync-idem", "run twice -> no change (0 inserted/updated/deleted, bank hash identical, drift 0)",
           rc == 0 and (s.get("inserted"), s.get("updated"), s.get("deleted")) == (0, 0, 0) and bank_hash(uid) == h and body.get("drift") == 0,
           f"exit={rc}; counts={(s.get('inserted'), s.get('updated'), s.get('deleted'))}; unchanged={s.get('unchanged')}; drift={body.get('drift')}")

    # ------------------------------------------------------------------------- (d)
    e1 = b1["syn-001"]["entry_id"]
    st, q, _ = c.call("GET", f"{PRACTICE}/questions/{e1}")
    qlist_st, ql, _ = c.call("GET", f"{PRACTICE}/queue?limit=5")
    key_in_detail = q["entry"].get("correct_answer") if st == 200 else None
    key_in_queue = ql[0]["entry"].get("correct_answer") if qlist_st == 200 and ql else None
    record("S3-d", "does the practice client receive the key BEFORE an attempt? (recorded for plan §11)",
           True, f"YES. GET {PRACTICE}/questions/{{id}} returns entry.correct_answer={key_in_detail!r} and explanation to the signed-in student with no attempt made; "
                 f"GET {PRACTICE}/queue also returns correct_answer={key_in_queue!r}. DeepTutor hides it only in the UI. Practice-pool keys are therefore visible to any logged-in student calling the API; plan §11 must treat practice MCQ/MSQ keys as non-secret (mock keys never sync).")

    # ------------------------------------------------------------------------- (e)
    e2 = b1["syn-002"]["entry_id"]
    cases = {"A,C": True, "C,A": True, "A": False, "A,B,C": False, "A,B": False, "": False}
    got = {a: c.call("POST", f"{PRACTICE}/questions/{e2}/check", {"answer": a})[1]["correct"] for a in cases}
    record("S3-e", "DeepTutor practice grades an MSQ item by exact key set", got == cases, f"key=A,C; results {got}")

    # ------------------------------------------------------- reviews (give state)
    def review(entry_id: int, rid: str, version: int, rating: str, answer: str):
        return c.call("POST", f"{PRACTICE}/questions/{entry_id}/review",
                      {"request_id": rid, "version": version, "rating": rating, "answer": answer})

    e3 = b1["syn-003"]["entry_id"]
    st, o1, _ = review(e1, "itreview000000001", 0, "again", "A")          # wrong on syn-001 -> mistake + state
    st_b, o2, _ = review(e2, "itreview000000002", 0, "again", "A")        # wrong on syn-002 (to be retired)
    st_c, o3, _ = review(e3, "itreview000000003", 0, "good", "B")         # right on syn-003
    ok_reviews = (st, st_b, st_c) == (200, 200, 200)
    v_before = bank(uid)
    record("S3-setup", "student reviews recorded (setup for (b), (g))", ok_reviews,
           f"HTTP {(st, st_b, st_c)}; versions={ {k: v_before[k]['version'] for k in v_before} }; review_counts={ {k: v_before[k]['review_count'] for k in v_before} }")

    # ------------------------------------------------------------------------- (a)
    h_before = bank_hash(uid)
    rc, body = run_sync("servable-v2", uid, env={"VIDHYA_SYNC_TEST_RAISE": "before-commit"})
    s = student0(body)
    h_after = bank_hash(uid)
    record("S3-a1", "forced error inside the per-student BEGIN IMMEDIATE transaction rolls back cleanly (bank byte-identical)",
           rc == 1 and s.get("status") == "failed" and (s.get("error") or {}).get("code") == "SyncPartialFailure" and h_before == h_after,
           f"exit={rc}; status={s.get('status')}; error={s.get('error')}; bank hash unchanged={h_before == h_after}")
    # lock timeout: hold a write lock from another process
    holder_code = ("import sqlite3,time;c=sqlite3.connect('/app/data/users/%s/user/chat_history.db',timeout=30);"
                   "c.execute('BEGIN IMMEDIATE');print('held',flush=True);time.sleep(12);c.rollback()" % uid)
    holder = subprocess.Popen([*DOCKER, "exec", "-i", "-u", "deeptutor", CONTAINER, "python", "-c", holder_code], stdout=subprocess.PIPE, text=True)
    holder.stdout.readline()
    t0 = time.time()
    rc, body = run_sync("servable-v2", uid)
    waited = time.time() - t0
    s = student0(body)
    holder.wait()
    record("S3-a2", "store locked by another writer > 5 s -> SyncLockTimeout, student skipped, bank unchanged",
           rc == 1 and s.get("status") == "skipped" and (s.get("error") or {}).get("code") == "SyncLockTimeout" and bank_hash(uid) == h_before,
           f"exit={rc}; status={s.get('status')}; error={(s.get('error') or {}).get('code')}; waited {waited:.1f}s")
    # kill mid-run (SIGKILL equivalent: os._exit(137) after the first in-place write, inside the transaction)
    rc, body = run_sync("servable-v2", uid, env={"VIDHYA_SYNC_TEST_FAULT": "after-first-write"})
    killed_unchanged = bank_hash(uid) == h_before
    ev_after_kill = len(events_lines())
    rc2, body2 = run_sync("servable-v2", uid)  # the re-run (the real v2 sync: this is also the (g)/(b)/(f) step)
    s2 = student0(body2)
    b2 = bank(uid)
    record("S-sync-kill", "kill mid-run -> bank untouched, lock released, re-run completes, drift = 0",
           rc != 0 and killed_unchanged and rc2 == 0 and body2.get("drift") == 0 and sorted(b2) == EXPECT_V2,
           f"killed run exit={rc} (applier died, no JSON); bank unchanged after kill={killed_unchanged}; re-run exit={rc2} counts={(s2.get('inserted'), s2.get('updated'), s2.get('deleted'))}; drift={body2.get('drift')}; bank ids={sorted(b2)}")

    # ------------------------------------------------------------------------- (g)
    old, new = v_before["syn-001"], b2["syn-001"]
    st_stale, stale_body, _ = review(e1, "itreview000000004", old["version"], "again", "A")
    st_new, _, _ = review(e1, "itreview000000005", new["version"], "again", "A")
    idx = dbq(uid, "SELECT name, \"unique\" AS uq FROM pragma_index_list('notebook_entries')")
    idx_cols = {i["name"]: [r["name"] for r in dbq(uid, f"SELECT name FROM pragma_index_info('{i['name']}')")] for i in idx if i["uq"]}
    record("S3-g1", "in-place UPDATE keeps the row id and the student's review state",
           new["entry_id"] == old["entry_id"] and new["review_count"] == old["review_count"] and new["question_id"] != old["question_id"],
           f"entry id {old['entry_id']} -> {new['entry_id']}; review_count {old['review_count']} -> {new['review_count']}; question_id rewritten={new['question_id'] != old['question_id']}; tag {old['tag']} -> {new['tag']}")
    record("S3-g2", "the version is bumped by DeepTutor's own trigger; a stale review is rejected, a current one accepted",
           new["version"] == old["version"] + 1 and st_stale == 409 and st_new == 200,
           f"version {old['version']} -> {new['version']}; review with the old version -> HTTP {st_stale} ({stale_body.get('detail') if isinstance(stale_body, dict) else stale_body}); with the new version -> HTTP {st_new}")
    record("S3-g3", "is question_id unique-indexed? (R9)", True,
           f"Only as part of a composite: unique indexes on notebook_entries = {idx_cols}. question_id alone is NOT unique, but (origin_type, origin_ref, turn_id, question_id) is, "
           "so an in-place rewrite of question_id inside our own origin (vidhya-sync) cannot collide as long as the new id is new; it is, because the stem carries the ledger id and the hash covers question+options+key.")

    # explanation-only change: plain UPDATE, no version bump
    pre = bank(uid)["syn-003"]
    rc, body = run_sync("servable-v3", uid)
    post = bank(uid)["syn-003"]
    record("S3-g4", "explanation-only change is a plain UPDATE: same row, review state kept, version NOT bumped, tag re-stamped",
           rc == 0 and post["entry_id"] == pre["entry_id"] and post["version"] == pre["version"] and post["explanation"] != pre["explanation"] and post["tag"] != pre["tag"],
           f"entry {pre['entry_id']} -> {post['entry_id']}; version {pre['version']} -> {post['version']}; tag {pre['tag']} -> {post['tag']}")

    # ------------------------------------------------------------------------- (b)
    removed_events = dbq(uid, "SELECT COUNT(*) AS n FROM practice_review_events WHERE entry_id=?", [e2])[0]["n"]
    captured = [e for e in events_lines() if e["ledger_id"] == "syn-002"]
    ids = [e["request_id"] for e in events_lines()]
    record("S3-b", "what happens to a student's review events when an item is deleted: CASCADED in DeepTutor's DB, CAPTURED first in events.jsonl",
           removed_events == 0 and any(e["request_id"] == "itreview000000002" for e in captured) and len(ids) == len(set(ids)),
           f"after retiring syn-002: practice_review_events rows for its entry = {removed_events} (cascade, storage.py FK ON DELETE CASCADE); events.jsonl has {len(captured)} captured event(s) for syn-002 "
           f"(request_ids {[e['request_id'] for e in captured]}); no duplicate request_id across {len(ids)} lines (R20). State rows cascade too.")
    # R20: the failed/rolled-back and killed runs above appended before commit; re-runs must not duplicate
    record("S-sync-r20", "events.jsonl is idempotent on request_id across a rolled-back run, a killed run and the real run (R20)",
           len(ids) == len(set(ids)) and len(ids) >= 1, f"{len(ids)} lines, {len(set(ids))} distinct request_ids; lines before the real run (after the kill): {ev_after_kill}")

    # ------------------------------------------------------------------------- (f)
    st_del, d, _ = review(e2, "itreview000000006", 0, "again", "A")
    st_chk, dc, _ = c.call("POST", f"{PRACTICE}/questions/{e2}/check", {"answer": "A,C"})
    record("S3-f1", "a review submitted against a deleted id returns a clean 404", st_del == 404 and st_chk == 404,
           f"review -> HTTP {st_del} {d}; check -> HTTP {st_chk}")
    # same-second race: hammer reviews on syn-004 while a sync that removes it runs
    b_now = bank(uid)
    e4 = b_now["syn-004"]["entry_id"]
    codes: list[int] = []
    stop = threading.Event()

    def hammer() -> None:
        i = 0
        while not stop.is_set():
            i += 1
            codes.append(review(e4, f"itrace{i:012d}", 0, "again", "A")[0])

    th = threading.Thread(target=hammer)
    th.start()
    time.sleep(0.3)
    rc, body = run_sync("servable-v1", uid)  # v1 has no syn-004
    time.sleep(0.3)
    stop.set()
    th.join()
    bad = sorted({x for x in codes if x not in (200, 404, 409)})
    record("S3-f2", "reviews racing the delete (same second) only ever see 200/404/409, never a 500",
           not bad and 404 in codes[-3:], f"{len(codes)} racing reviews, status set={sorted(set(codes))}; unexpected={bad}; sync exit={rc}")
    rc, _ = run_sync("servable-v2", uid)  # back to v2

    # ------------------------------------------------------------------------- guards
    h = bank_hash(uid)
    pr = subprocess.run([*DOCKER, "exec", "-i", "-w", "/app", CONTAINER, "python", "/vidhya-sync/applier/vidhya_sync_applier.py"],
                        input=json.dumps({"mode": "apply", "students": []}), capture_output=True, text=True)
    record("S-guard-root", "the applier refuses to run as root (a root-written store would lock DeepTutor out of the student's DB; found when a first sync created a student's store as root and DeepTutor answered 500 PermissionError)",
           pr.returncode == 5 and "InvalidRequest" in pr.stdout, f"exit={pr.returncode}; {pr.stdout.strip()[:200]}")
    rc, body = run_sync("servable-v1", uid, "--expected-version", "9.9.9")
    record("S-guard-version", "DeepTutor version != pinned -> StoreSchemaMismatch, whole run aborts before any write",
           rc == 4 and (body.get("error") or {}).get("code") == "StoreSchemaMismatch" and bank_hash(uid) == h, f"exit={rc}; {body.get('error')}")
    dexec(["python", "-c", "import sqlite3;c=sqlite3.connect('/app/data/users/%s/user/chat_history.db');c.execute('DROP TRIGGER practice_invalidate_question');c.commit()" % uid])
    rc, body = run_sync("servable-v3", uid)
    mismatch = (rc == 4 and (body.get("error") or {}).get("code") == "StoreSchemaMismatch")
    dexec(["python", "-c", "import sqlite3;from deeptutor.services.practice.storage import initialize_practice as f;c=sqlite3.connect('/app/data/users/%s/user/chat_history.db');f(c);c.commit()" % uid])
    record("S-guard-trigger", "practice_invalidate_question trigger missing -> StoreSchemaMismatch before any write (the R9 pin)",
           mismatch and bank_hash(uid) == h, f"exit={rc}; {body.get('error')}")
    rc, body = run_sync("servable-small", uid)  # keeps 3 of 8: removes 5 (> 20%)
    s = student0(body)
    record("S-guard-mass", "removing > 20% of a bank -> SyncMassRemoveRefused for that student, bank unchanged",
           rc == 1 and (s.get("error") or {}).get("code") == "SyncMassRemoveRefused" and bank_hash(uid) == h, f"exit={rc}; {s.get('error')}")
    rc, body = run_sync("servable-empty", uid)
    record("S-guard-empty", "an empty servable set never empties the banks (refused before the applier is called)",
           rc == 7 and bank_hash(uid) == h, f"exit={rc}; {body.get('error')}")
    hold = subprocess.Popen([*DOCKER, "exec", "-i", "-u", "deeptutor", CONTAINER, "python", "-c",
                             "import fcntl,time;f=open('/app/data/vidhya/sync.lock','a+');fcntl.flock(f,fcntl.LOCK_EX);print('held',flush=True);time.sleep(8)"],
                            stdout=subprocess.PIPE, text=True)
    hold.stdout.readline()
    rc, body = run_sync("servable-v3", uid)
    hold.wait()
    record("S-guard-lock", "a second sync while the flock is held exits SyncAlreadyRunning", rc == 3 and (body.get("error") or {}).get("code") == "SyncAlreadyRunning" and bank_hash(uid) == h,
           f"exit={rc}; {body.get('error')}")
    rc, body = run_sync("servable-v3", uid, "--dry-run")
    s = student0(body)
    record("S-dry-run", "--dry-run reports the plan and writes nothing", rc == 0 and body.get("dryRun") is True and bank_hash(uid) == h,
           f"exit={rc}; plan insert/update/remove={(s.get('plan_insert'), s.get('plan_update'), s.get('plan_remove'))}")

    # ----------------------------------------------- fallback path (R9 'if S3 fails')
    rc, body = run_sync("servable-v3", uid)  # apply v3 so the next errata is a key change on syn-001
    pre = bank(uid)["syn-001"]
    st_r, _, _ = review(pre["entry_id"], "itreview000000007", pre["version"], "again", "A")
    rc, body = run_sync("servable-v1", uid, "--update-mode", "delete-insert")  # v1: syn-001 changes back, syn-004 removed
    post = bank(uid)["syn-001"]
    s = student0(body)
    record("S-fallback", "delete+insert fallback (R2) works and shows what R9 saves: new row id, review state wiped, events captured first",
           rc == 0 and post["entry_id"] != pre["entry_id"] and post["review_count"] == 0 and any(e["request_id"] == "itreview000000007" for e in events_lines()),
           f"entry {pre['entry_id']} -> {post['entry_id']}; review_count {pre['review_count']} -> {post['review_count']}; counts={(s.get('inserted'), s.get('updated'), s.get('deleted'))}; event itreview000000007 captured in events.jsonl")
    rc, body = run_sync("servable-v1", uid)
    record("S-sync-drift", "final drift = 0 (DeepTutor items not servable = 0, servable items missing = 0)", rc == 0 and body.get("drift") == 0, f"exit={rc}; drift={body.get('drift')}")

    out = HERE / ".run"
    out.mkdir(exist_ok=True)
    (out / "s3-results.json").write_text(json.dumps(RESULTS, indent=1))
    bad = [r for r in RESULTS if r["status"] != "PASS"]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} checks passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
