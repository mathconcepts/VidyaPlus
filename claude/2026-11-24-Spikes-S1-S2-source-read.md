# Spikes S1 and S2 (plan T2): what the pinned DeepTutor source settles, and what still needs a live run

Date: 24 Nov 2026 · Branch `brain/w0-prep` · DeepTutor v1.7.3 (`upstream/deeptutor`, pristine).
Docker isn't available in the agent workspace, so these spikes read the pinned source only. Each one lists what's settled and what still needs a live run on a box with DeepTutor up (W0).

## S1: `/exam` behind Caddy, session from `dt_token`

| Question | Answer from source | Evidence |
|---|---|---|
| Is the cookie sent to `/exam/*` on the same host? | **Yes.** `set_cookie` passes no `path`, so Starlette's default `Path=/` applies. | `deeptutor/api/routers/auth.py` `_cookie_attrs()` (key, httponly, samesite, secure only) |
| Will SameSite block it? | **No.** `lax`, or `none` when `cookie_secure` is set. `/exam` is the same site, so both send it. | `auth.py:36-37` |
| Can the brain read it in JS? | **No**, and it doesn't need to: it's httponly. The brain's server reads the `Cookie` header and forwards it. | `_cookie_attrs()` |
| Does `/api/auth/status` turn the cookie into a user? | **Yes.** It returns `enabled`, `authenticated`, `user_id`, `is_admin`. | `auth.py:880-931`, `AuthStatusResponse` at 340 |
| Trap | With `AUTH_ENABLED=false`, every request is `local-admin`. The brain refuses that unless it runs in dev mode (`AuthDisabled`). | `auth.py:887-895`; `vidhya/brain/src/session/resolve.ts` |
| Pinned on upgrade | `scripts/upstream/check-auth-contract.py` runs in `sync-deeptutor.sh` and in the brain tests. | T15 |

**Status: passes from source.** Still needs a live run: a real login → `/exam` round trip on a phone at 360 px, KaTeX rendering, and an expired cookie redirecting to login.

## S2: brain MCP granted through `grants.mcp_tools`

| Question | Answer from source | Evidence |
|---|---|---|
| Can DeepTutor reach an HTTP MCP server? | **Yes.** `MCPServerConfig` takes `url` (streamableHttp, or `/sse`) plus static `headers`. | `deeptutor/services/mcp/config.py:31-51` |
| What are the tool names? | `mcp_<server>_<tool>`, with non-alphanumerics replaced by `_`. Grants must use exactly these names. | `services/mcp/manager.py:102` |
| Per-student grant? | **Yes.** Non-admins are **deny-by-default** (a missing `mcp_tools` means none). Admins are unrestricted. | `multi_user/tool_access.py:55-69`, `runtime/providers/authorize.py` |
| Does chat honour the grant? | **Yes.** The loop pipeline narrows by the grant and the caller filter. | `agents/loop/pipeline.py:705` |
| Who registers the server? | An admin, deployment-wide (`mcp_settings` router). The brain's tools are identity-free, so one shared server is fine (R7). | `api/routers/mcp_settings.py:82` |

**Status: passes from source.** Still needs a live run: the tutor calls `mcp_vidhya_explain_receipt` in a real chat for a granted student, and a non-granted student can't see it.

## New finding for S3 and the eng review (not a plan change yet)

The pinned practice store has a `practice_invalidate_question` trigger. An `UPDATE` of `question`, `options_json` or `correct_answer` on `notebook_entries` bumps `practice_review_state.version`, and `review()` checks the version a client submits. So an errata could be applied **in place**: same entry id, review history kept, stale submissions rejected. That avoids the delete-and-cascade path (SF5) that R2's event capture exists to protect.

R2 stays as written (capture before delete) until S3 shows which path is safe. Questions for S3:
- Does an in-place update keep the `ledger:<id>@<fp8>` tag in step?
- Does an explanation-only change (not covered by the trigger, SF6) still need delete-and-insert?

S3 needs DeepTutor's full schema (notebook_entries, sessions), so it runs at W0 against a real container.
