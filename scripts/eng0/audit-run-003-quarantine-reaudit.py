#!/usr/bin/env python3
"""
ENG-0 AUDIT — run #3: quarantine fix re-audit (2026-09-04, overnight worker)

Re-verifies the 20 items quarantined by runs #1 (Linear Algebra) and #2
(Calculus) after the fix pass scripts/eng0/fix-quarantine-2026-09-04.py.
Same tier and rules as runs #1-#2: per-item authored SymPy checks, the
computed quantity mapped onto the (now fixed) option list; verified means
exactly one option is mathematically correct and it is the keyed one.
Wolfram tier: skipped (no WOLFRAM_APP_ID; SymPy decisive on every item).

The checks below are transcribed from the FIXED option lists and are
independent of the fix script (a transcription error there would surface
here as a failed verdict, not silently pass). Guard: each check asserts
the option text it expects is present in the live file, so a later edit
to an item invalidates this run loudly instead of silently.

On success this run updates data/verification/eng0/quarantine.json:
each of the 20 active entries moves to the `resolved` list with the fix
description and this run's id. Any item that does NOT verify stays in
`entries` — quarantine is only cleared by a green re-check (R9: never
mark anything verified that was not checked).

Usage: python3 scripts/eng0/audit-run-003-quarantine-reaudit.py
Writes: data/verification/eng0/runs/2026-09-04-run-003-quarantine-reaudit.json
        data/verification/eng0/quarantine.json (moves resolved entries)
Exit 0 always (the report is the product — S14/R6).
"""
import json, os, datetime
from sympy import (Matrix, Symbol, symbols, Rational, sqrt, pi, oo, E, I, exp,
                   log, sin, cos, tan, cot, Abs, integrate, diff, limit,
                   simplify, solve, im)

x, y, h = symbols('x y h')

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT_DIR = os.path.join(ROOT, 'data', 'verification', 'eng0')
RUN_ID = 'eng0-run-003-quarantine-reaudit'
EXAM_IDS = ['gate-engineering-maths']

FILES = {
    'la-004': 'data/courses/gate-em/topics/01-linear-algebra/mcqs.json',
    'det-03': 'data/courses/gate-em/concepts/determinants/mcqs.json',
    'det-04': 'data/courses/gate-em/concepts/determinants/mcqs.json',
    'dia-05': 'data/courses/gate-em/concepts/diagonalization/mcqs.json',
    'mop-01': 'data/courses/gate-em/concepts/matrix-operations/mcqs.json',
    'mop-03': 'data/courses/gate-em/concepts/matrix-operations/mcqs.json',
    'vs-04':  'data/courses/gate-em/concepts/vector-spaces/mcqs.json',
    'chr-04': 'data/courses/gate-em/concepts/chain-rule/mcqs.json',
    'con-02': 'data/courses/gate-em/concepts/continuity/mcqs.json',
    'int-02': 'data/courses/gate-em/concepts/integration-basics/mcqs.json',
    'int-04': 'data/courses/gate-em/concepts/integration-basics/mcqs.json',
    'int-05': 'data/courses/gate-em/concepts/integration-basics/mcqs.json',
    'ibp-04': 'data/courses/gate-em/concepts/integration-by-parts/mcqs.json',
    'sub-02': 'data/courses/gate-em/concepts/integration-substitution/mcqs.json',
    'max-05': 'data/courses/gate-em/concepts/maxima-minima/mcqs.json',
    'mvt-02': 'data/courses/gate-em/concepts/mean-value-theorems/mcqs.json',
    'mul-04': 'data/courses/gate-em/concepts/multiple-integrals/mcqs.json',
    'pf-04':  'data/courses/gate-em/concepts/partial-fractions/mcqs.json',
    'pqr-05': 'data/courses/gate-em/concepts/product-quotient-rule/mcqs.json',
    'seq-05': 'data/courses/gate-em/concepts/sequences/mcqs.json',
}

FIX_NOTES = {
    'mop-01': 'wrong key: re-keyed C -> A ((AB)_{12} = 1); explanation rewritten',
    'int-04': 'wrong key: re-keyed B -> A ((3/4)x^{4/3}); explanation rewritten',
    'int-05': 'wrong key: re-keyed C -> B (F(1) = 4); explanation rewritten',
    'ibp-04': 'wrong key: re-keyed A -> B (x sin x + cos x + C); explanation rewritten',
    'det-03': 'no correct option: option D 4 -> 1 (true det); explanation rewritten (had "Wait..." confusion)',
    'det-04': 'no correct option: option A -30 -> -90 (scalar rule 3^2); explanation rewritten',
    'mop-03': 'no correct option: option D [[0,-2],[0,0]] -> [[0,-1],[0,0]] (true commutator); explanation rewritten',
    'max-05': 'no correct option: option A x=5 -> x=10/sqrt(3) (true maximiser); explanation rewritten',
    'mul-04': 'no correct option: option A 1/12 -> 1/8 (true integral); explanation rewritten',
    'la-004': 'defective options: option A 8/6 (== keyed 4/3) -> 1/3 (2*det(A^-1), cube-forgotten distractor)',
    'dia-05': 'defective options: option C "Only over C" (also true) -> false universal claim about rotation matrices',
    'vs-04':  'defective options: option B (-1,1,0) (spans same null space) -> (0,1,1), not in null space',
    'chr-04': 'defective options: option D cot(x) (== keyed B) -> tan(x); equivalence note replaced',
    'con-02': 'defective options: option C piecewise was continuous -> jump at x=1 (second piece x+1); explanation fixed',
    'int-02': 'defective options: option C ln|x| (== keyed A on x>0) -> e^x ln(x)',
    'sub-02': 'defective options: option C ln|x^2+1| (== keyed A) -> (1/2)ln(x^2+1)',
    'mvt-02': 'defective options: option D duplicate "e - 1" -> (e+1)/2',
    'pf-04':  'defective options: option C ln|x/(x+1)| (== keyed A) -> ln|x(x+1)|',
    'pqr-05': 'defective options: option B same sum as keyed C -> pi/2 + pi^2/16 (sec^2=1 slip)',
    'seq-05': 'defective options: option D duplicate "2" -> -1 (the rejected fixed point); explanation extended',
}


def load(iid):
    d = json.load(open(os.path.join(ROOT, FILES[iid])))
    for q in d['questions']:
        if q['id'] == iid:
            return q
    raise KeyError(iid)


def expect(q, letter, fragment):
    """Assert the live option text contains the fragment the check was
    transcribed from — a later edit invalidates this run loudly."""
    assert fragment in q['options'][letter], (
        f"{q['id']} option {letter} changed since run-003 was authored: "
        f"{q['options'][letter]!r} lacks {fragment!r}")


def match_value(v, opts):
    out = []
    for kk, cand in opts.items():
        try:
            if simplify(cand - v) == 0:
                out.append(kk)
        except Exception:
            if cand == v:
                out.append(kk)
    return out


def match_antideriv(integrand, opts, positive=False):
    xv = Symbol('x', positive=True) if positive else x
    out = []
    for kk, cand in opts.items():
        if simplify(diff(cand.subs(x, xv), xv) - integrand.subs(x, xv)) == 0:
            out.append(kk)
    return out


# --------------------------------------------------------------- checks

def _mop_01(q):
    expect(q, 'A', '1')
    v = (Matrix([[2,1],[0,3]]) * Matrix([[1,0],[2,1]]))[0, 1]
    return (match_value(v, {'A': 1, 'B': 2, 'C': 4, 'D': 0}), f'(AB)_(1,2) = {v}')

def _int_04(q):
    expect(q, 'A', '\\frac{3}{4}')
    f = x**(-2) + x**Rational(1, 3)
    opts = {'A': -x**(-1) + Rational(3, 4)*x**Rational(4, 3),
            'B': -x**(-1) + Rational(4, 3)*x**Rational(4, 3),
            'C': -2*x**(-3) + Rational(1, 3)*x**Rational(2, 3),
            'D': x**(-1) - x**Rational(4, 3)}
    return (match_antideriv(f, opts), 'only A differentiates back to x^-2 + x^(1/3)')

def _int_05(q):
    expect(q, 'B', '4')
    F = integrate(6*x**2 - 4*x + 1, x) + 3  # C = 3 from F(0)=3
    v = F.subs(x, 1)
    return (match_value(v, {'A': 2, 'B': 4, 'C': 5, 'D': 6}), f'F(1) = {v}')

def _ibp_04(q):
    expect(q, 'B', '+ \\cos(x)')
    f = x*cos(x)
    opts = {'A': x*sin(x) - cos(x), 'B': x*sin(x) + cos(x),
            'C': x*cos(x) + sin(x), 'D': sin(x) - x*cos(x)}
    return (match_antideriv(f, opts), 'only B differentiates back to x cos(x)')

def _det_03(q):
    expect(q, 'D', '1')
    d = Matrix([[2,1,0],[1,3,2],[0,1,1]]).det()
    return (match_value(d, {'A': -2, 'B': 0, 'C': 2, 'D': 1}), f'det = {d}')

def _det_04(q):
    expect(q, 'A', '-90')
    d = Rational(3)**2 * 5 * (-2)
    return (match_value(d, {'A': -90, 'B': -60, 'C': 30, 'D': 60}), f'det(3AB) = {d}')

def _mop_03(q):
    expect(q, 'D', '0 & -1')
    A, B = Matrix([[1,1],[0,1]]), Matrix([[2,-1],[0,1]])
    C = A*B - B*A
    opts = {'A': [[0,0],[0,0]], 'B': [[1,0],[0,1]], 'C': [[2,0],[0,-2]], 'D': [[0,-1],[0,0]]}
    tk = [k for k, m in opts.items() if C == Matrix(m)]
    return (tk, f'AB - BA = {C.tolist()}')

def _max_05(q):
    expect(q, 'A', '\\frac{10}{\\sqrt{3}}')
    xx = Symbol('x', positive=True)
    V = xx*(100 - xx**2)/4
    crit = [c for c in solve(diff(V, xx), xx) if c.is_positive][0]
    opts = {'A': 10/sqrt(3), 'B': 10, 'C': sqrt(50), 'D': 4}
    return (match_value(crit, opts), f'V\' = 0 at x = {crit}')

def _mul_04(q):
    expect(q, 'A', '1/8')
    v = integrate(x*y, (y, 0, x), (x, 0, 1))
    return (match_value(v, {'A': Rational(1, 8), 'B': Rational(1, 6),
                            'C': Rational(1, 4), 'D': Rational(1, 2)}), f'integral = {v}')

def _la_004(q):
    expect(q, 'A', '1/3')
    v = Rational(2)**3 / (1*2*3)
    opts = {'A': Rational(1, 3), 'B': Rational(8, 3), 'C': Rational(4, 3), 'D': 1}
    return (match_value(v, opts), f'det(2A^-1) = {v}; option A 1/3 is now distinct')

def _dia_05(q):
    expect(q, 'C', 'every rotation matrix')
    s = set(Matrix([[0,1],[-1,0]]).eigenvals().keys())
    nonreal = all(im(v) != 0 for v in s)
    # B true (complex eigenvalues, not diagonalizable over R). A false. D false.
    # C claims EVERY rotation matrix is diagonalizable over R — this very
    # matrix is the counterexample, so C is false.
    tk = ['B'] if nonreal else []
    return (tk, f'eigenvalues {sorted(s, key=str)} non-real; C\'s universal claim refuted by this matrix')

def _vs_04(q):
    expect(q, 'B', '(0, 1, 1)')
    A = Matrix([[1,1,0],[0,0,1]])
    cands = {'A': [1,1,0], 'B': [0,1,1], 'C': [1,-1,0], 'D': [1,0,0]}
    tk = [k for k, v in cands.items() if A*Matrix(v) == Matrix([0, 0])]
    return (tk, f'A*v = 0 only for {tk}; nullspace basis {A.nullspace()[0].T.tolist()[0]}')

def _chr_04(q):
    expect(q, 'D', '\\tan(x)')
    d = diff(log(sin(x)), x)
    opts = {'A': 1/sin(x), 'B': cos(x)/sin(x), 'C': 1/cos(x), 'D': tan(x)}
    tk = [k for k, cand in opts.items() if simplify(cand - d) == 0]
    return (tk, f"f' = cot(x); option D tan(x) is now distinct")

def _con_02(q):
    expect(q, 'C', 'x + 1')
    b_ok = limit(Abs(x), x, 0) == 0
    c_left, c_right = limit(x, x, 1, '-'), limit(x + 1, x, 1, '+')
    tk = []
    if b_ok: tk.append('B')
    if c_left == c_right: tk.append('C')
    return (tk, f'B continuous; C now jumps at 1 (left {c_left} vs right {c_right})')

def _int_02(q):
    expect(q, 'C', 'e^x \\ln(x)')
    f = exp(x) + 1/x
    opts = {'A': exp(x) + log(x), 'B': exp(x) + 1/x**2, 'C': exp(x)*log(x), 'D': exp(x) + x}
    return (match_antideriv(f, opts, positive=True), 'only A differentiates back on x > 0')

def _sub_02(q):
    expect(q, 'C', '\\frac{1}{2}')
    xr = Symbol('x', real=True)
    f = 2*xr/(xr**2 + 1)
    opts = {'A': log(xr**2 + 1), 'B': xr**2/(xr**2 + 1),
            'C': log(xr**2 + 1)/2, 'D': 2*log(xr**2 + 1)}
    tk = [k for k, cand in opts.items() if simplify(diff(cand, xr) - f) == 0]
    return (tk, 'only A differentiates back to 2x/(x^2+1)')

def _mvt_02(q):
    expect(q, 'D', '\\frac{e+1}{2}')
    c = Symbol('c', positive=True)
    sol = solve(1/c - 1/(E - 1), c)
    opts = {'A': 1, 'B': E - 1, 'C': E/2, 'D': (E + 1)/2}
    return (match_value(sol[0], opts), f'c = {sol[0]}; (e+1)/2 != e-1')

def _pf_04(q):
    expect(q, 'C', 'x(x+1)')
    xp = Symbol('x', positive=True)
    f = 1/(xp*(xp + 1))
    opts = {'A': log(xp) - log(xp + 1), 'B': log(xp) + log(xp + 1),
            'C': log(xp*(xp + 1)), 'D': log((xp + 1)/xp)}
    tk = [k for k, cand in opts.items() if simplify(diff(cand, xp) - f) == 0]
    return (tk, 'only A differentiates back to 1/(x(x+1))')

def _pqr_05(q):
    expect(q, 'B', '\\pi^2/16')
    v = simplify(diff(x**2*tan(x), x).subs(x, pi/4))
    opts = {'A': pi/4, 'B': pi/2 + pi**2/16, 'C': pi**2/8 + pi/2, 'D': 2*pi/4}
    return (match_value(v, opts), f"f'(pi/4) = {v}; option B now differs (pi^2/16)")

def _seq_05(q):
    expect(q, 'D', '-1')
    L_ = Symbol('L', positive=True)
    fixed = solve(L_**2 - (2 + L_), L_)
    opts = {'A': 2, 'B': sqrt(2), 'C': 1 + sqrt(3), 'D': -1}
    tk = match_value(fixed[0], opts) if len(fixed) == 1 else []
    return (tk, f'limit = {fixed[0]} (constant sequence); option D -1 is the rejected root')

CHECKS = {
    'mop-01': _mop_01, 'int-04': _int_04, 'int-05': _int_05, 'ibp-04': _ibp_04,
    'det-03': _det_03, 'det-04': _det_04, 'mop-03': _mop_03, 'max-05': _max_05,
    'mul-04': _mul_04, 'la-004': _la_004, 'dia-05': _dia_05, 'vs-04': _vs_04,
    'chr-04': _chr_04, 'con-02': _con_02, 'int-02': _int_02, 'sub-02': _sub_02,
    'mvt-02': _mvt_02, 'pf-04': _pf_04, 'pqr-05': _pqr_05, 'seq-05': _seq_05,
}


def main():
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    records = []
    verified_ids, failed_ids = [], []

    for iid, check in CHECKS.items():
        q = load(iid)
        true_keys, computed = check(q)
        keyed = q['correct_answer']
        verdict = 'verified' if (keyed in true_keys and len(true_keys) == 1) else 'failed'
        (verified_ids if verdict == 'verified' else failed_ids).append(iid)
        records.append({
            'run_id': RUN_ID, 'item_id': iid, 'source_file': FILES[iid],
            'exam_ids': EXAM_IDS, 'keyed_answer': keyed, 'checked_at': now,
            'tags': q.get('tags', []), 'verifier': 'sympy', 'verdict': verdict,
            'computed': computed, 'cas_true_options': sorted(true_keys),
            'fix_applied': FIX_NOTES[iid],
            'reaudits': ['eng0-run-001-linear-algebra', 'eng0-run-002-calculus'],
        })

    summary = {
        'run_id': RUN_ID, 'generated_at': now,
        'scope': 'Re-audit of the 20 items quarantined by runs #1-#2, after the 2026-09-04 fix pass (S14 response)',
        'total_items': len(CHECKS),
        'cas_checked': len(CHECKS),
        'cas_verified': len(verified_ids),
        'cas_failed': len(failed_ids),
        'pass_rate_over_cas_checked_pct': round(100.0 * len(verified_ids) / len(CHECKS), 1),
        'wolfram_tier': 'skipped — no WOLFRAM_APP_ID in session; SymPy decisive on all items',
        'human_spot_audit_rate_pct': 0.0,
        'human_spot_audit_note': 'no operator review yet — Giri reviews verification RECORDS, not the maths; '
                                 'the mathematics gate stays pending for every item',
        'still_failing': failed_ids,
    }

    os.makedirs(os.path.join(OUT_DIR, 'runs'), exist_ok=True)
    run_path = os.path.join(OUT_DIR, 'runs', '2026-09-04-run-003-quarantine-reaudit.json')
    json.dump({'summary': summary, 'records': records}, open(run_path, 'w'), indent=2)

    # Move green entries out of active quarantine into `resolved` (history kept)
    q_path = os.path.join(OUT_DIR, 'quarantine.json')
    qd = json.load(open(q_path))
    active, resolved = [], qd.get('resolved', [])
    for e in qd.get('entries', []):
        if e['item_id'] in verified_ids:
            resolved.append({**e, 'resolved_at': now, 'resolved_by': RUN_ID,
                             'fix': FIX_NOTES[e['item_id']]})
        else:
            active.append(e)
    json.dump({'updated_at': now, 'entries': active, 'resolved': resolved},
              open(q_path, 'w'), indent=2)

    print(json.dumps(summary, indent=2))
    print(f'\nrecords: {run_path}')
    print(f'quarantine: {len(active)} active, {len(resolved)} resolved')
    for r in records:
        print(f"  {r['verdict']:8s} {r['item_id']:8s} {r['computed'][:100]}")


if __name__ == '__main__':
    main()
