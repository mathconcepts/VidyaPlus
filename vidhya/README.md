# vidhya/ — everything that makes DeepTutor into Vidhya

DeepTutor lives untouched in `upstream/deeptutor/`. Every Vidhya-specific change lives here. It is applied on top at build time by `scripts/upstream/assemble.sh`, or it runs beside DeepTutor as a standalone service (the Exam Brain).

## Where a change goes (use the first rung that works)

1. **Configuration.** Environment variables, model/provider settings, DeepTutor's own settings files. No code.
2. **Content.** Exam packs imported through DeepTutor's practice import. Data, not code.
3. **Standalone service or MCP** (`brain/`, `sync/`). Vidhya logic (GATE marking, CAS checks, the marks planner, the mock, disputes) lives in the Exam Brain, a TypeScript service. Students reach it at `/exam` on the same domain behind Caddy, and it identifies them from DeepTutor's `dt_token` cookie via `GET /api/auth/status`. DeepTutor's tutor reaches it as an MCP server granted per student through `grants.mcp_tools`, which is configuration (rung 1). A DeepTutor plugin can't do this job in 1.7.3: plugin workers get no user identity, plugin pages run under `connect-src 'none'`, and plugin tools never reach tutor chat. See the CEO plan of 24 Nov, R1.
4. **Branding** (`branding/`). `brand.json` rewrites the product name in all UI text at build time; `branding/public/` replaces logos and icons.
5. **Patch** (`patches/deeptutor/NNNN-short-name.patch`). Last resort, for what rungs 1–4 cannot do (for example a hard-coded name in a React component or prompt). One concern per patch, numbered, with a header saying why no plugin could do it. Every DeepTutor upgrade re-checks that each patch still applies.

Never edit `upstream/deeptutor/` directly. CI and the pre-commit hook reject it.

## Folders

- `branding/` — brand name, string overrides, assets, the locale rewrite script.
- `patches/deeptutor/` — the patch queue (empty today).
- `brain/` — the Exam Brain: GATE marking, CAS checks, `/exam` app, MCP tools (see PORTING.md).
- `ui/` — `@vidhya/ui`: the Clarity token CSS and the shared ui components (React is a peer dependency). The legacy `frontend/` reaches it through a `@vidhya/ui` alias.
- `exam/` — the student-facing `/exam` app (Vite + React, `base: '/exam/'`). Talks to the brain only through `src/api/types.ts` (`ExamApi`); `FakeExamApi` serves synthetic data until the HTTP API exists. `npm run check-budget` enforces 250 KB gzipped first load.
- `shared/` — dependency-free modules both the brain and the browser load (`nat-input.ts`).
- `package.json` — npm workspaces for `ui` and `exam` only, so one React is hoisted. `brain/` is not a member. Run `npm ci` here, then `npm test`.
- `sync/` — `vidhya sync`, which keeps each student's DeepTutor practice bank equal to the servable pack.
- `plugins/` — DeepTutor plugins, if a later need fits that contract (none today).
