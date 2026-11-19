# The Number — verified pass rate of the committed content bank

> Plan reference: ENG-0 (CEO plan 2026-08-29, §5.2). This page is the running,
> honest record. It is updated by every audit run and published whatever it
> says (S14). Nothing on this page is a marketing figure; every count links to
> a per-item verification record.

## Running state (after run #3, 2026-09-04)

| Metric | Value |
|---|---|
| Bank audited so far | GATE-EM **Linear Algebra** (run #1) + **Calculus** (run #2, first slice of the 28-mark common block) |
| Items audited | **194** (84 LA + 110 calculus) of the committed GATE-EM MCQ banks |
| CAS-checked (SymPy, decisive) | 176 (70 + 106) |
| **Verified in the bank as served today (CAS confirmed key, unique correct option)** | **176 / 176 CAS-checked = 100%** — after the 2026-09-04 fix-and-re-audit of the 20 quarantined items (run #3) |
| **As generated (before any fix)** | **156 / 176 = 88.6%** — the honest generation-quality figure; it does not change because the bank was repaired |
| Conceptual (theorem/definitional; no decisive CAS check) — **unverified** | 18 (14 + 4) — served only with an "unverified" label (advisory single-LLM solves agree with all 18 keys) |
| Quarantine | **0 active** — all 20 entries resolved by run #3; full fix log kept in `data/verification/eng0/quarantine.json` (`resolved` list) |
| Human spot-audit rate | **0%** so far (no operator review yet) |
| Wolfram tier | not used in any run (no `WOLFRAM_APP_ID`; SymPy was decisive on every parsed item) |
| Method-tag second layer | not applicable to these file-catalog banks (no expected-method field); applies to generated items |

**S14 status: CLEARED as of run #3 (2026-09-04).** The running Number fell to
88.6% with run #2 and S14 fired: the rate was published, generation paused,
and the failing item classes became the overnight fix queue. That queue is now
done — all 20 quarantined items were repaired (4 wrong keys re-keyed, 5
missing-true-value option lists corrected, 11 duplicate-option lists given
distinct distractors, and every "Wait, let me recalculate…" generator
confusion stripped from served explanations) and re-verified by independent
checks in run #3. **Content generation stays paused**: the as-generated rate
is 88.6%, and the authoring-time lint that would prevent the largest failure
class (CAS-equivalent option pairs, 11 of 20 defects) does not exist yet.
Resuming generation before that lint ships would recreate the defect class;
un-pausing is Giri's call, surfaced in the brief.

**How to quote this outward (S-7 / MK-4 / grant material):** "194 items
audited; as generated, 88.6% of CAS-checkable items passed; every failure is
published in a quarantine log; all 20 failures fixed and re-verified — the
served bank is now 100% CAS-verified, with theorem items labelled unverified."
Never quote the 100% without the 88.6% beside it — the audit finding IS the
credibility.

**What "verified" means here:** a SymPy check, authored per item from the
item's own data, recomputed the asked quantity and found exactly one option
mathematically correct — the keyed one. Check code:
`scripts/eng0/audit-run-001-linear-algebra.py`,
`scripts/eng0/audit-run-002-calculus.py`,
`scripts/eng0/audit-run-003-quarantine-reaudit.py` (fix pass:
`scripts/eng0/fix-quarantine-2026-09-04.py`); per-item records at
`data/verification/eng0/runs/`.

**What it does not mean:** the `mathematics` gate is still operator-decided
(`src/generation/gate-ledger.ts`) — these records are evidence, not
approvals. The 18 conceptual items carry a single-LLM advisory solve only
(all 18 agree with the key) and are **not** counted as verified. No human
spot-audit has happened yet; when it does, the reviewer checks verification
records and method evidence, not the mathematics itself, and its rate will
be stated here.

## Failing item classes (as generated — now all fixed, lint still owed)

1. **Antiderivative constant/coefficient slips** (int-04, ibp-04, int-05) —
   wrong keys from mis-applied power rule / sign in integration by parts.
2. **"True value not among the options"** (det-03, det-04, mop-03, max-05,
   mul-04) — the item author solved a different problem than the one posed.
3. **Equivalent-expression distractors** (11 items) — option lists containing
   two renderings of the same mathematical object (ln x vs ln|x|, cot vs
   cos/sin, scalar multiples of a basis vector, literal duplicates). A lint
   pass that CAS-compares every option pair at authoring time would have
   caught all 11 before commit. **This lint is the gate on resuming
   generation.**

## Fix log (run #3, 2026-09-04)

Wrong keys re-keyed to the CAS-true option: `mop-01` (C→A), `int-04` (B→A),
`int-05` (C→B), `ibp-04` (A→B). True value restored into the keyed slot:
`det-03` (D: 4→1), `det-04` (A: −30→−90), `mop-03` (D: true commutator),
`max-05` (A: 5→10/√3), `mul-04` (A: 1/12→1/8). Duplicate options replaced
with distinct distractors: `la-004`, `dia-05`, `vs-04`, `chr-04`, `con-02`,
`int-02`, `sub-02`, `mvt-02`, `pf-04`, `pqr-05`, `seq-05`. Per-item detail:
`data/verification/eng0/quarantine.json` (`resolved`) and
`data/verification/eng0/runs/2026-09-04-run-003-quarantine-reaudit.json`.

## Audit history

| Run | Date | Scope | Checked | Verified | Pass rate (checked) | Running as-generated rate | Quarantined |
|---|---|---|---|---|---|---|---|
| #1 | 2026-09-02 | LA (84 items) | 70 | 63 | 90.0% | 90.0% | 7 |
| #2 | 2026-09-03 | Calculus (110 items) | 106 | 93 | 87.7% | **88.6%** | 13 |
| #3 | 2026-09-04 | Fix + re-audit of the 20 quarantined items | 20 | 20 | 100% | 88.6% (as generated; served bank now 176/176) | 0 active (20 resolved) |

Next: run #4 — differential equations + complex variables (rest of the
28-mark common block); run #5 — probability-statistics; the option-pair
equivalence lint (authoring-time, gates generation un-pause); ENG-0 (e)
`ci:content-gate` enforcement of "no unlabelled unverified item served"
against this file ledger. Verification records carry `exam_ids` (currently
`gate-engineering-maths`) so the Number can be reported per exam when the
JEE profile (ENG-10) lands.
