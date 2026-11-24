# Porting ledger: project-vidhya → Vidhya on DeepTutor

VidyaPlus started from project-vidhya `main` (0b26eb4b). The old TypeScript app still sits at the repo root (`src/`, `frontend/`, `supabase/`, …) as the source to port from. New work goes into `vidhya/`. Each row below moves to **done** only when its target works on the assembled app; the legacy code is then deleted in the same PR.

Status: `todo` · `in progress` · `done` · `parked` (with the reason) · `dropped` (DeepTutor already does it).

| Legacy asset | What it is | Target | Rung | Status |
|---|---|---|---|---|
| `data/courses/gate-em/` + patch-stack ledger | Verified GATE EM bank, explainers | Exam pack in a private content repo, imported into DeepTutor practice | Content | todo |
| `funnel/` (branch `funnel/gate-diagnostic-v0`) | Diagnostic site, Apps Script webhook | `vidhya/funnel/` (static site, deployed separately) | Standalone | in progress |
| `src/verification/verifiers/` (SymPy, Wolfram) | CAS answer checks with receipts | `vidhya/brain/src/verify/` (`cas_check`, offline only; `tiered-orchestrator.ts` not ported) | Standalone | in progress |
| `src/scoring/deterministic-scorer.ts`, `src/exams/marking-constants.ts` | GATE marking (MCQ, MSQ, NAT, negative marks) | `vidhya/brain/src/scoring/` (`check_answer`, HTTP + MCP) | Standalone | in progress |
| `src/readiness/diagnostic-warmup.ts`, `mock-to-marks.ts` | Placement and mock analysis | `vidhya/brain/src/readiness/` (B4 planner, B5 mock) | Standalone | todo |
| (new) | Exam app: Today card, NAT practice, mock, marks, report | `vidhya/exam/` (Vite + React, `base: '/exam/'`, built into the brain image, served at `/exam` behind Caddy, session from `dt_token` → `/api/auth/status`). UI done against `FakeExamApi`; real HTTP, KaTeX pre-render and handwriting (T31) remain | Standalone | in progress |
| (new) | Tutor tools: `check_answer`, `get_verified_item`, `explain_receipt`, `report_item` | Brain MCP server, granted per student via `grants.mcp_tools` | Configuration | todo |
| `src/constants/concept-graph.ts`, `data/curriculum/` | Concept graph, prerequisites, weightage | Exam pack metadata | Content | todo |
| `frontend/src/styles/tokens/`, `frontend/src/components/ui/{ReceiptBorder,Button,ListRow,TabBar,SegmentedControl,EmptyState,TextField,ProgressBar}`, `frontend/src/lib/receipt` | Clarity tokens + ui components | `vidhya/ui/` (workspace package `@vidhya/ui`, React as a peer dependency). The legacy `frontend/` imports them through a `@vidhya/ui` alias | Standalone | done |
| Brand: "Vidhya" name, logo | Product identity | `vidhya/branding/` | Branding | in progress (UI text done) |
| `design/clarity/`, `DESIGN-SYSTEM.md` | Clarity design tokens | Theme patch on DeepTutor's Tailwind config, if still wanted | Patch | parked until after 30 Dec |
| `src/gbrain/` (Elo, FSRS, student model) | Student model | Plugin capability | Plugin | parked (out of scope until 30 Dec) |
| `src/generation/`, `src/content/prompt-registry/` | Content factory | Separate factory service writing packs | Standalone | parked until after 30 Dec |
| `src/api/chat-routes.ts` (tutor chat) | Streaming tutor | DeepTutor's own chat + Wolfram tool | — | dropped |
| `frontend/` (React SPA) | Old student UI | DeepTutor web, rebranded | — | dropped |
| `src/server.ts`, `supabase/`, `render.yaml` | Old API and deploy | Retired once every row above is done or dropped | — | todo |
