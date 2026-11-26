#!/usr/bin/env python3
"""Spike S2 without an LLM: does a standard student with grants.mcp_tools see an MCP server in
tutor chat, and do its tools run? Verified at the layer that decides it: DeepTutor's own
build_tool_view (what a tutor turn runs before the model is called), executed in the container
as each user against the real MCP manager and the deployment's real settings/mcp.json.

NOT verified here (needs a model): that the LLM chooses to call explain_receipt in a live chat.
That step runs only when VIDHYA_IT_LLM=1 and a gateway key is present (see the workflow).
Stand-in server: mock_brain_mcp.py (stdio). The real brain MCP endpoint is built elsewhere.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import s3_checks as h  # noqa: E402  (shared client, docker helpers, record())

TOOLS = ["mcp_vidhya_check_answer", "mcp_vidhya_explain_receipt", "mcp_vidhya_report_item"]


def view_as(users: dict, call: str) -> dict:
    p = subprocess.run([*h.DOCKER, "exec", "-i", "-u", "deeptutor", "-w", "/app", h.CONTAINER, "python", "/vidhya-sync/integration/s2_tool_view.py"],
                       input=json.dumps({"users": users, "call": call}), capture_output=True, text=True)
    last = [x for x in p.stdout.splitlines() if x.startswith("{")][-1]
    return json.loads(last)


def main() -> int:
    admin = h.Client()
    st, _, hd = admin.call("POST", "/api/auth/login", {"username": os.environ.get("IT_ADMIN_USER", "it-admin"), "password": os.environ.get("IT_ADMIN_PASS", "it-admin-pass-1234")}, cookie=None)
    admin.cookie = hd.get("set-cookie", "").split("dt_token=", 1)[1].split(";", 1)[0]
    s1 = h.Client(); s1.login()
    u1 = s1.call("GET", "/api/auth/status")[1]
    # a second, never-granted student
    st, _, _ = admin.call("POST", "/api/auth/users", {"username": "it-student-2", "password": h.PASSWORD})
    s2 = h.Client()
    os.environ["IT_STUDENT_USER"] = "it-student-2"
    h.STUDENT = "it-student-2"; s2.login(); h.STUDENT = "it-student-1"
    u2 = s2.call("GET", "/api/auth/status")[1]

    st, body, _ = admin.call("PUT", "/api/settings/mcp/servers/vidhya", {"command": "python", "args": ["/vidhya-sync/integration/mock_brain_mcp.py"]})
    status = {x["name"]: x for x in body.get("status", [])} if isinstance(body, dict) else {}
    names = sorted(t["name"] for t in status.get("vidhya", {}).get("tools", []))
    h.record("S2-a", "an admin registers the server in the deployment registry; it connects and names its tools mcp_<server>_<tool>",
             st == 200 and status.get("vidhya", {}).get("status") == "connected" and names == TOOLS, f"HTTP {st}; status={status.get('vidhya', {}).get('status')}; tools={names}")

    st, _, _ = admin.call("PUT", f"/api/multi-user/users/{u1['user_id']}/grants", {"grant": {"mcp_tools": TOOLS}})
    st2, g2, _ = admin.call("GET", f"/api/multi-user/users/{u2['user_id']}/grants")
    users = {"granted": {"id": u1["user_id"], "username": "it-student-1"}, "ungranted": {"id": u2["user_id"], "username": "it-student-2"}}
    res = view_as(users, "mcp_vidhya_explain_receipt")
    g, u = res["granted"], res["ungranted"]
    h.record("S2-b", "a standard (non-admin) student granted grants.mcp_tools is offered the vidhya tools in the tutor turn's tool view",
             st == 200 and g["pool"] == TOOLS and g["manifest_mentions_server"], f"grant PUT HTTP {st}; pool={g['pool']}; manifest lists server={g['manifest_mentions_server']}")
    h.record("S2-c", "the granted student's tool executes through the turn's scoped registry (explain_receipt returns the synthetic receipt, no values)",
             g.get("call_result", {}).get("success") is True, f"{g.get('call_result')}")
    h.record("S2-d", "a student whose grant omits mcp_tools sees none of them and a dispatch of the name is refused (deny by default)",
             st2 == 200 and g2["grant"]["mcp_tools"] is None and u["pool"] == [] and u.get("call_when_ungranted", {}).get("success") is False,
             f"ungranted grant.mcp_tools={g2['grant']['mcp_tools']}; pool={u['pool']}; dispatch={u.get('call_when_ungranted')}")
    # per-name grant: only one tool granted
    admin.call("PUT", f"/api/multi-user/users/{u1['user_id']}/grants", {"grant": {"mcp_tools": ["mcp_vidhya_explain_receipt"]}})
    one = view_as({"granted": users["granted"]}, "mcp_vidhya_check_answer")["granted"]
    h.record("S2-e", "grants are per exact tool name: granting only mcp_vidhya_explain_receipt hides check_answer and report_item",
             one["pool"] == ["mcp_vidhya_explain_receipt"] and one.get("call_when_ungranted", {}).get("success") is False, f"pool={one['pool']}; dispatch of check_answer={one.get('call_when_ungranted')}")
    admin.call("PUT", f"/api/multi-user/users/{u1['user_id']}/grants", {"grant": {"mcp_tools": TOOLS}})

    # who can register what
    c1, _, _ = s1.call("PUT", "/api/settings/mcp/servers/evil", {"command": "python", "args": ["-c", "1"]})
    c2, b2, _ = s1.call("PUT", "/api/space/mcp/servers/mine", {"config": {"command": "python", "args": ["-c", "1"]}, "secrets": {}})
    c3, b3, _ = s1.call("PUT", "/api/space/mcp/servers/mine2", {"config": {"url": "http://127.0.0.1:8787/mcp"}, "secrets": {}})
    c4, _, _ = s1.call("PUT", f"/api/multi-user/users/{u1['user_id']}/grants", {"grant": {"mcp_tools": None}})
    h.record("S2-f", "a student cannot edit the deployment registry or their own grants, and self-service servers must be public remote URLs (no stdio, no loopback/private)",
             (c1, c4) == (403, 403) and c2 == 400 and c3 == 400,
             f"student PUT deployment server -> {c1}; PUT own grants -> {c4}; self-service stdio -> {c2} {b2.get('detail', {}).get('code') if isinstance(b2, dict) else ''}; self-service loopback URL -> {c3} {b3.get('detail', {}).get('code') if isinstance(b3, dict) else ''}")
    # remote URL form the real brain will use: static bearer header, private/loopback host accepted for the ADMIN registry
    cA, bA, _ = admin.call("PUT", "/api/settings/mcp/servers/probe-private", {"url": "http://127.0.0.1:8787/mcp", "headers": {"Authorization": "Bearer synthetic"}})
    cfg = (bA.get("servers", {}).get("probe-private") if isinstance(bA, dict) else None) or {}
    cB, bB, _ = admin.call("PUT", "/api/settings/mcp/servers/probe-dns", {"url": "http://brain-not-running:8787/mcp"})
    admin.call("DELETE", "/api/settings/mcp/servers/probe-private"); admin.call("DELETE", "/api/settings/mcp/servers/probe-dns")
    h.record("S2-g", "the admin registry accepts a private/loopback http URL with a static bearer header (R3); a hostname must RESOLVE when it is saved",
             cA == 200 and cfg.get("headers", {}).get("Authorization") == "Bearer synthetic" and cB == 400,
             f"private URL + header -> HTTP {cA}, header stored={cfg.get('headers')}; unresolvable host -> HTTP {cB} {bB.get('detail') if isinstance(bB, dict) else bB}. "
             "So the brain container must be up (resolvable) before it is registered; the stdio and streamableHttp transports are both usable.")
    h.record("S2-h", "the tutor LLM actually calls explain_receipt in a real chat", None,
             "NOT VERIFIED: needs a model/gateway key. The tool view, grant gate and tool execution are proven above; the model's decision to call is not. "
             "Runs in brain-integration only when the VIDHYA_IT_LLM secret is present.")
    admin.call("DELETE", "/api/settings/mcp/servers/vidhya")

    out = h.HERE / ".run"; out.mkdir(exist_ok=True)
    (out / "s2-results.json").write_text(json.dumps(h.RESULTS, indent=1))
    bad = [r for r in h.RESULTS if r["status"] == "FAIL"]
    print(f"\n{sum(r['status'] == 'PASS' for r in h.RESULTS)} pass, {len(bad)} fail, {sum(r['status'] == 'UNKNOWN' for r in h.RESULTS)} unknown")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
