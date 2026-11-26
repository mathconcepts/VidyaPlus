#!/usr/bin/env python3
"""Runs INSIDE the DeepTutor container (docker exec -i ... python). For each user id given on
stdin it builds DeepTutor's real provider tool view (the code a tutor turn runs before the LLM
is called) as that user, against the real MCP manager and the deployment's real mcp.json, and
reports the MCP tool names the user would be offered; then executes one granted tool.

stdin: {"users": {"label": {"id": "u_...", "username": "..."}}, "call": "mcp_vidhya_explain_receipt"}
stdout: JSON {label: {"pool": [...], "manifest_mentions_server": bool, "call_result": ...}}
"""
import asyncio
import json
import sys

sys.path.append("/app")


async def main() -> None:
    req = json.load(sys.stdin)
    from deeptutor.multi_user.context import reset_current_user, set_current_user
    from deeptutor.multi_user.models import CurrentUser
    from deeptutor.multi_user.paths import scope_for_user
    from deeptutor.runtime.providers.scope import ToolScope
    from deeptutor.runtime.providers.view import build_tool_view
    from deeptutor.runtime.registry.tool_registry import get_tool_registry
    from deeptutor.services.mcp import get_mcp_manager

    out = {}
    for label, u in req["users"].items():
        role = u.get("role", "user")
        user = CurrentUser(id=u["id"], username=u["username"], role=role, scope=scope_for_user(u["id"], is_admin=role == "admin"))
        token = set_current_user(user)
        try:
            view = await build_tool_view(base_registry=get_tool_registry(), scope=ToolScope(owner_id=u["id"], session_id="s2-check"))
            names = sorted(t.get_definition().name for t in view.pool)
            row = {"pool": names, "manifest_mentions_server": "vidhya" in (view.manifest or "")}
            call = req.get("call")
            if call and call in names:
                res = await view.registry.execute(call, item_id="syn-001")
                row["call_result"] = {"success": res.success, "content": res.content}
            elif call:
                res = await view.registry.execute(call, item_id="syn-001")
                row["call_when_ungranted"] = {"success": res.success, "content": str(res.content)[:200]}
            out[label] = row
        finally:
            reset_current_user(token)
    await get_mcp_manager().shutdown()
    print(json.dumps(out))


asyncio.run(main())
