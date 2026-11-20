# CLAUDE.md — VidyaPlus

Vidhya is a GATE exam-prep product sold as a service (datasets, courses, software) with its founder as the first creator. The student app is **DeepTutor, rebranded as Vidhya**. This repo holds a pristine copy of DeepTutor plus the Vidhya layer on top.

Current decisions (Nov 2026): GATE EC Engineering Mathematics only until the 30 Dec 2026 go/stop decision; JEE is a waitlist page only; everything free until the 14 Dec pay ask. Architecture doc: "Vidhya as a Service: Architecture" in the Vidhya claude.ai project.

## Mandatory constraints

These hold for every change. If a task seems to need breaking one, stop and ask.

1. **Never edit `upstream/deeptutor/`.** It must stay byte-identical to the DeepTutor release in `upstream/deeptutor.lock`. `scripts/upstream/check-pristine.sh` enforces it in CI and in the pre-commit hook (`scripts/upstream/install-hooks.sh`, run once per clone).
2. **Upgrade DeepTutor only with `scripts/upstream/sync-deeptutor.sh <tag>`**, on its own branch and PR. Never mix a sync with Vidhya changes.
3. **Every Vidhya-specific change goes in `vidhya/`**, using the first rung that works: configuration → content (exam packs) → DeepTutor plugin → branding → patch. Patches are the last resort; each needs a header saying why a plugin can't do it. See `vidhya/README.md`.
4. **Porting from the legacy app is tracked in `PORTING.md`.** Port into `vidhya/`, mark the row done, delete the legacy code in the same PR. Don't add new code to the legacy root folders (`src/`, `frontend/`, `supabase/`, …).
5. **Keep DeepTutor's licence intact.** Apache-2.0: keep `upstream/deeptutor/LICENSE` and notices, list changes in the generated `NOTICE-VIDHYA.md`, and keep a "Built on DeepTutor" credit in the app's About page. The rebrand replaces the product name, not the attribution.
6. **Receipts never lie.** An item shows "verified" or "reviewed" only with a real verification record whose fingerprint matches the item. No pack ships unverified.
7. **The verified bank is the product.** Question banks, receipts and pain-point data do not go in this public repo; they belong in a private content repo. Official exam papers and textbook text are never sold, only cited.
8. **Students are 18+** until consent and parental verification exist (India DPDP duties apply from 13 May 2027). No phone numbers or names in docs or commits.
9. **Outreach is human.** WhatsApp messages are sent one to one by the founder; no automated sending.

## Layout

```
upstream/deeptutor/        DeepTutor release, untouched (Apache-2.0)
upstream/deeptutor.lock    pinned tag, commit and tree hash
vidhya/                    the Vidhya layer: branding/, patches/deeptutor/, plugins/
scripts/upstream/          check-pristine, sync-deeptutor, assemble, install-hooks
PORTING.md                 legacy → vidhya/ ledger
src/ frontend/ supabase/   legacy project-vidhya app: read-only source for porting
```

## Common tasks

```bash
scripts/upstream/install-hooks.sh                 # once per clone
scripts/upstream/check-pristine.sh                # is upstream/deeptutor/ untouched?
scripts/upstream/assemble.sh build/vidhya-app     # DeepTutor + Vidhya layer → buildable app
scripts/upstream/sync-deeptutor.sh v1.8.0         # upgrade DeepTutor (own branch + PR)
```

DeepTutor's own developer docs are in `upstream/deeptutor/docs-for-dev/`; the plugin contract is `PLUGINS.md` there. CI (`.github/workflows/upstream-guard.yml`) runs the pristine check and the assemble step on every PR, and opens an issue every Monday when DeepTutor has a newer release.

## Working style

- Plan with gstack (`/autoplan`, `/plan-eng-review`); save plans to the claude.ai project, not into this file.
- Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.
- This file holds current rules only. Release notes go in `CHANGELOG.md`, decisions in the project docs. The pre-November history of this file is in git (`git show 0b26eb4b:CLAUDE.md`).

## Legacy app (until PORTING.md is done)

The old TypeScript API and React app still build and test: `npm install && npm test` (backend), `cd frontend && npm install && npm test`. Its CI is `.github/workflows/ci.yml`. Its docs (`ARCHITECTURE.md`, `EXTENDING.md`, `DESIGN-SYSTEM.md`, …) describe the legacy app, not the DeepTutor-based one.
