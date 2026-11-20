# vidhya/ — everything that makes DeepTutor into Vidhya

DeepTutor lives untouched in `upstream/deeptutor/`. Every Vidhya-specific change lives here, and is applied on top at build time by `scripts/upstream/assemble.sh` or installed into the running app as a DeepTutor plugin.

## Where a change goes (use the first rung that works)

1. **Configuration.** Environment variables, model/provider settings, DeepTutor's own settings files. No code.
2. **Content.** Exam packs imported through DeepTutor's practice import. Data, not code.
3. **Plugin** (`plugins/`). DeepTutor's plugin contract (`deeptutor.plugin/v1`, see `upstream/deeptutor/docs-for-dev/PLUGINS.md`) supports tools, capabilities, HTTP routes under `/api/plugins/<id>/…` and sandboxed static pages. Vidhya logic (CAS checks, GATE marking, packs, diagnostics) goes here.
4. **Branding** (`branding/`). `brand.json` rewrites the product name in all UI text at build time; `branding/public/` replaces logos and icons.
5. **Patch** (`patches/deeptutor/NNNN-short-name.patch`). Last resort, for what rungs 1–4 cannot do (for example a hard-coded name in a React component or prompt). One concern per patch, numbered, with a header saying why no plugin could do it. Every DeepTutor upgrade re-checks that each patch still applies.

Never edit `upstream/deeptutor/` directly. CI and the pre-commit hook reject it.

## Folders

- `branding/` — brand name, string overrides, assets, the locale rewrite script.
- `patches/deeptutor/` — the patch queue (empty today).
- `plugins/` — Vidhya's DeepTutor plugins (first one: `vidhya-exam`, see PORTING.md).
