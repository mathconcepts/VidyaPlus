"""Build the B1 parity golden from DeepTutor's own grader.

Runs the pinned upstream `deeptutor/services/practice/answers.py`
`check_answer` (pure Python, no deps) over a fixed set of MCQ/MSQ cases and
writes what it returns. The brain's scorer must give the same `correct` flag
on every case (plan B1). Re-run after every DeepTutor upgrade; the vitest
parity test also re-runs it when python3 is present and fails on drift.

Usage: python3 -I scripts/gen-parity-golden.py <repo-root> [--check]
"""
import importlib.util, json, sys, pathlib

root = pathlib.Path(sys.argv[1]).resolve()
src = root / "upstream/deeptutor/deeptutor/services/practice/answers.py"
spec = importlib.util.spec_from_file_location("dt_answers", src)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

L = "ABCD"
opts = {k: f"option {k.lower()}" for k in L}
cases = []
# MCQ: key x every selection
for key in range(4):
    for sel in range(4):
        cases.append({"kind": "mcq", "key": [key], "sel": [sel], "dt_type": "choice",
                      "dt_key": L[key], "dt_answer": L[sel]})
# MSQ: a spread of key sets x selections, incl. subset, superset, disjoint, reordered
msq_keys = [[0, 2], [1, 2, 3], [0, 1, 2, 3], [3, 0]]
msq_sels = [[0, 2], [2, 0], [0], [0, 1, 2], [1, 3], [1, 2, 3], [3, 2, 1], [0, 1, 2, 3], [3]]
for key in msq_keys:
    for sel in msq_sels:
        k = ",".join(L[i] for i in sorted(key))
        a = ",".join(L[i] for i in sel)
        cases.append({"kind": "msq", "key": key, "sel": sel, "dt_type": "multi_choice",
                      "dt_key": k, "dt_answer": a})
for c in cases:
    entry = {"question_type": c["dt_type"], "options": opts, "correct_answer": c["dt_key"]}
    c["dt_correct"] = mod.check_answer(entry, c["dt_answer"])

out = {"source": "upstream/deeptutor/deeptutor/services/practice/answers.py", "cases": cases}
text = json.dumps(out, indent=1) + "\n"
target = pathlib.Path(__file__).resolve().parent.parent / "src/scoring/__fixtures__/deeptutor-parity-golden.json"
if "--check" in sys.argv:
    sys.exit(0 if target.read_text() == text else 3)
target.write_text(text)
print(f"wrote {len(cases)} cases")
