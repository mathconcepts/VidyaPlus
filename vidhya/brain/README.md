# Exam Brain

Marking, CAS receipts, the mock and disputes for the GATE EC Engineering Mathematics pilot. It serves the `/exam` app over HTTP and the tutor over MCP, beside DeepTutor. Plan: `claude/2026-11-24-CEO-Plan-Exam-Brain-GATE-EC-EM.md` (section 3, section 22).

## Run it

```bash
cd vidhya/brain && npm install
npm run build                      # tsc to dist/ (dist/brain/src, dist/shared)

# 1. migrate, as its own deploy step (E13). Takes an online backup first.
node dist/brain/src/cli/vidhya.js migrate "$VIDHYA_DB" "$VIDHYA_BACKUP_DIR"

# 2. start. Refuses to start on an old schema; never migrates.
npm start                          # = build, then node dist/brain/src/server.js
```

`npm install -g`-style use: the package has a `bin` entry `vidhya` (`dist/brain/src/cli/vidhya.js`).

### Server settings (environment)

| Variable | Meaning |
|---|---|
| `VIDHYA_DB` | SQLite file (required) |
| `PACK_DIR` | a pack release directory with `items.jsonl` and `exam.json` (required) |
| `DEEPTUTOR_URL` | DeepTutor base URL on the docker/loopback network; the brain calls `GET /api/auth/status` with the student's `dt_token` cookie (required) |
| `VIDHYA_HASH_SALT` | salt for the registry hashes (required) |
| `APP_ORIGIN` | the one `Origin` allowed to write, e.g. `https://learn.example.org` (required) |
| `PORT`, `HOST` | default `8080`, `127.0.0.1` |
| `LOGIN_PATH` | default `/login`; `GET /v1/login?return=` redirects here, with the return path forced under `/exam/` |
| `SYNC_TOKEN` | bearer secret for `GET /v1/servable` (the sync command sends it as `VIDHYA_BRAIN_TOKEN`); unset turns that route off |
| `BUILD_ID` | reported in `/health`, `/v1/session` and the `X-Vidhya-Build` header |

`exam.json` is what the pack build writes from `exam.yaml`: `{ version, marking, timing, topics, tiers, mock, section_marks? }`. `section_marks` is the marks the exam section carries (the "of N" under the marks range): a positive number; when absent it defaults to the sum of the topics' `weight_marks`; when that is 0 too, `/v1/marks` says no section marks are set.

At boot the brain renders every pack item's stem, options and solution to KaTeX HTML (`renderOnSync`, idempotent per fingerprint and KaTeX version). Items are served only from those stored rows: an item whose render failed or is missing is left out of topics, Today and the mock form, and a direct request gets `RenderFailed` / `RenderMissing` (503). Raw TeX is never a fallback.

### Routes

- `GET /health` (no auth): pack version, schema version, DB writable, DeepTutor reachable, mock form state.
- `/v1/*`: the contract in `vidhya/shared/api-contract.ts` (route table `ROUTE_PATTERNS`). Identity comes only from the `dt_token` cookie. Every response carries `Cache-Control: private, no-store`. Writes need `Origin` = `APP_ORIGIN` and a JSON body. 60 requests a minute per student.
- `GET /v1/servable?pool=practice&type=MCQ,MSQ[&version=]` (internal, for `vidhya sync`): `{pack_version, items: Item[]}` with full keys. Not a student route: no cookie, bearer `SYNC_TOKEN` required, refused unless the peer address is loopback or private (10/8, 172.16/12, 192.168/16, fc00::/7) and refused when any forwarding header is present (so it cannot be reached through the Caddy proxy even if mis-routed). Only `pool=practice` is accepted: a mock-pool item is never returned. Verified items without an open dispute overlay only. `version` that differs from the served pack is `409 PackVersionMismatch`. Keep it off Caddy's `/exam/*` path.
- `POST /mcp`: Streamable HTTP MCP with `check_answer`, `explain_receipt`, `report_item`. Identity-free, every tool refuses mock items. Keep it reachable only on the DeepTutor to brain network (Caddy proxies `/exam/*` only).

Errors are `{ "code": "<BrainError code>", "message": "..." }` with the status from `src/http/errors.ts`.

### Admin CLI

```bash
vidhya mock close <form_version>                 # refuses until every attempt window (deadline + 2 min) has ended
vidhya mock reset <student_hash> --reason "host outage 09:05 to 09:40" [--minutes 20]
vidhya migrate <db-path> <backup-dir>
```

`mock` commands read `VIDHYA_DB` and `PACK_DIR` (or `--db`, `--pack`) and name the actor from `--actor` or `VIDHYA_ACTOR`. Both write append-only `mock_audit` rows. A reset needs a reason text; the text is the record of the outage.

## Tests

```bash
npm test && npm run typecheck && npm run lint:fork-test
```

HTTP tests run a real server beside a stub DeepTutor auth server; the no-leak contract in `src/mock/__tests__` is repeated over HTTP in `src/http/__tests__`. All fixtures are synthetic.

## Not built yet

The full B4 planner (Today uses a small starter planner and shows no marks estimate) and ledger sync.
