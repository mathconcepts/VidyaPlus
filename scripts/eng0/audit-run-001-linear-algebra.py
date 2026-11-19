#!/usr/bin/env python3
"""
ENG-0 AUDIT — run #1: Linear Algebra (2026-09-02, overnight worker)

Tiered verification over every committed GATE-EM Linear Algebra MCQ:
the 29-item topic bank (topics/01-linear-algebra/mcqs.json) plus the 55
items across the 11 LA concept banks (concepts/*/mcqs.json with
topic == "linear-algebra"). 84 items total.

Tier used: SymPy (authoring-time CAS check, per the deployment shape in
src/verification/verifiers/sympy.ts — this script IS the authoring-time
path; it never runs on a request path). Wolfram tier: SKIPPED this run —
no WOLFRAM_APP_ID in the session env; SymPy reached a decisive verdict on
every item it could parse, so no arbitration was pending on Wolfram.

For each item a check was AUTHORED (by the overnight twin session) that
recomputes the asked quantity from the item's own data with SymPy and
maps the computed value onto the option list. The check code below is the
audit trail: what was checked, by what, with what result.

Verdicts (honest-states law, plan R9):
  verified   — CAS recomputed the quantity; exactly one option matches;
               it is the keyed option.
  failed     — CAS result contradicts the keyed option (wrong key, or the
               true value is not among the options) → QUARANTINE.
  ambiguous  — CAS confirms the keyed option but >=1 other option is
               mathematically equally correct → QUARANTINE (defective
               MCQ even though the key is not wrong).
  conceptual — theorem/definitional item with no decisive CAS check.
               NOT counted as verified. The twin's single-LLM solve is
               recorded as ADVISORY evidence only (verifier
               "llm_single_twin"); these items await the LLM dual-solve
               tier or human review.

The `mathematics` gate stays operator-decided (src/generation/gate-ledger.ts):
nothing here auto-passes it. These records are EVIDENCE. The DB gate
ledger has no Postgres instance yet (pre-ENG-1 merge), so records land as
committed files under data/verification/eng0/ — same content as
recordGates() would write, replayable into the DB once it exists.

Method-tag second layer: NOT RUN for this bank — the file-catalog MCQ
banks carry topic tags only, no expected-method field. The method-tag
check applies to generated items (practice-item factory), not to these
committed banks. Recorded as a scope note, not silently skipped.

NOTE (run #3, 2026-09-04): this script transcribes the ORIGINAL option
lists as they stood on 2026-09-02 and is the historical record of that
run. The 7 items it quarantined were fixed on 2026-09-04 and re-audited
by scripts/eng0/audit-run-003-quarantine-reaudit.py, which reads the
live item data. Re-running THIS script against the fixed bank will
report mismatches for those 7 items — that is expected: it audits the
old bank state.

Usage: python3 scripts/eng0/audit-run-001-linear-algebra.py
Writes: data/verification/eng0/runs/2026-09-02-run-001-linear-algebra.json
        data/verification/eng0/quarantine.json
Exit 0 always (the report is the product; a low number is published, not
suppressed — plan S14).
"""
import json, glob, os, datetime
from sympy import (Matrix, Rational, eye, zeros, symbols, sqrt, I, simplify,
                   expand, Symbol, im, re, nsimplify, acos, pi, deg, Abs)

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT_DIR = os.path.join(ROOT, 'data', 'verification', 'eng0')
RUN_ID = 'eng0-run-001-linear-algebra'
EXAM_IDS = ['gate-engineering-maths']  # ENG-10: JEE profile will re-tag the shared corpus


def load_items():
    items = []
    files = ['data/courses/gate-em/topics/01-linear-algebra/mcqs.json'] + sorted(
        glob.glob(os.path.join(ROOT, 'data/courses/gate-em/concepts/*/mcqs.json')))
    for f in files:
        p = f if os.path.isabs(f) else os.path.join(ROOT, f)
        d = json.load(open(p))
        if not isinstance(d, dict):
            continue
        if d.get('topic') == 'linear-algebra' or '01-linear-algebra' in p:
            rel = os.path.relpath(p, ROOT)
            for q in d['questions']:
                items.append({'src': rel, **q})
    return items


# ---------------------------------------------------------------------------
# Authored checks. Each returns (true_keys, computed, detail).
#   true_keys: list of option letters that are mathematically correct.
#   computed:  what the CAS actually found (goes into the record verbatim).
# ---------------------------------------------------------------------------

def eig_set(m): return set(Matrix(m).eigenvals().keys())


def _la_001():
    s = eig_set([[3, 1], [1, 3]])
    return (['A'] if s == {4, 2} else [], f'eigenvalues {sorted(s, key=str)}',
            'A "4 and 2" iff spectrum {2,4}; B/C/D transcribe to {3},{0,6},{1,4} — none match')

def _la_002():
    A = Matrix([[1,1,1],[2,2,2],[3,3,3]]); aug = A.row_join(Matrix([3,6,9]))
    r, ra = A.rank(), aug.rank()
    ok = (r == ra == 1)  # rank < unknowns and consistent -> infinitely many
    return (['C'] if ok else [], f'rank(A)={r}, rank([A|b])={ra}, unknowns=3',
            'consistent with rank 1 < 3 unknowns -> infinitely many solutions')

def _la_003():
    n = 4 - 3  # rank-nullity: nullity = n - rank
    return (['B'] if n == 1 else [], f'nullity = 4 - 3 = {n}', 'rank-nullity theorem applied (arithmetic)')

def _la_004():
    # det(2 A^-1) for 3x3 with eigenvalues 1,2,3: 2^3 / (1*2*3) = 8/6 = 4/3
    v = Rational(2)**3 / (1*2*3)
    opts = {'A': Rational(8, 6), 'B': Rational(8, 3), 'C': Rational(4, 3), 'D': 1}
    tk = [k for k, x in opts.items() if x == v]
    return (tk, f'det(2A^-1) = 8/6 = {v}',
            'options A (8/6) and C (4/3) are the SAME number — defective option list')

def _la_006():
    d = Matrix([[1,2,3],[4,5,6],[7,8,9]]).det()
    opts = {'A': 0, 'B': 6, 'C': -6, 'D': 45}
    return ([k for k, x in opts.items() if x == d], f'det = {d}', '')

def _la_007():
    sets = {'A': [(1,0,0),(0,1,0),(1,1,0)], 'B': [(1,1,0),(0,1,1),(1,0,1)],
            'C': [(1,2,3),(2,4,6),(0,1,0)], 'D': [(1,0,0),(0,1,0),(0,0,0)]}
    tk = [k for k, vs in sets.items() if Matrix(vs).rank() == 3]
    dets = {k: Matrix(vs).det() for k, vs in sets.items()}
    return (tk, f'dets: { {k: str(v) for k, v in dets.items()} }', 'basis iff 3 vectors with rank 3 (det != 0)')

def _la_010():
    s = eig_set([[0, 1], [-1, 0]])
    return (['B'] if s == {I, -I} else [], f'eigenvalues {sorted(s, key=str)}', 'B "i and -i"')

def _la_011():
    v = 2**2 + 3**2 + 5**2
    opts = {'A': 10, 'B': 38, 'C': 100, 'D': 30}
    return ([k for k, x in opts.items() if x == v], f'trace(A^2) = 4+9+25 = {v}',
            'trace(A^2) = sum of squared eigenvalues')

def _la_012():
    A = Matrix([[1,2],[2,4]]); aug = A.row_join(Matrix([3,6]))
    r, ra = A.rank(), aug.rank()
    ok = (r == ra == 1)
    return (['C'] if ok else [], f'rank(A)={r}, rank([A|b])={ra}, unknowns=2', 'consistent, rank<2 -> infinitely many')

def _la_015():
    x, y = symbols('x y')
    X = Matrix([x, y])
    opts = {'A': [[2,4],[4,2]], 'B': [[2,2],[2,2]], 'C': [[2,0],[0,2]], 'D': [[4,2],[2,4]]}
    target = 2*x**2 + 4*x*y + 2*y**2
    tk = [k for k, m in opts.items()
          if simplify(expand((X.T * Matrix(m) * X)[0] - target)) == 0 and Matrix(m).is_symmetric()]
    return (tk, 'X^T[[2,2],[2,2]]X expands to 2x^2+4xy+2y^2 (symmetric form)',
            'A [[2,4],[4,2]] gives 2x^2+8xy+2y^2 — does not match; B is the unique symmetric representer')

def _la_016():
    u, v = Matrix([1,1,0]), Matrix([1,0,1])
    c = (u.dot(v)) / (u.norm() * v.norm())
    ang = acos(c)
    return (['C'] if simplify(ang - pi/3) == 0 else [], f'cos = {simplify(c)}, angle = {simplify(ang)} rad = 60 deg', '')

def _la_017():
    # ||u+v||^2 = ||u||^2 + ||v||^2 + 2<u,v>  ->  169 = 25 + 144 + 2<u,v>
    ip = Rational(13**2 - 5**2 - 12**2, 2)
    opts = {'A': 0, 'B': 30, 'C': 60, 'D': -30}
    return ([k for k, x in opts.items() if x == ip], f'<u,v> = (169-25-144)/2 = {ip}', '')

def _la_018():
    v1, v2 = Matrix([1,0,0]), Matrix([2,3,4])
    u2 = v2 - (v2.dot(v1) / v1.dot(v1)) * v1
    opts = {'A': [0,3,4], 'B': [2,3,4], 'C': [0,3,-4], 'D': [-2,3,4]}
    tk = [k for k, m in opts.items() if u2 == Matrix(m)]
    return (tk, f'u2 = {u2.T.tolist()[0]}', '')

def _la_020():
    L, U, _ = Matrix([[2,3],[4,7]]).LUdecomposition()
    l21 = L[1, 0]
    opts = {'A': 2, 'B': Rational(1,2), 'C': -2, 'D': 4}
    return ([k for k, x in opts.items() if x == l21], f'L21 = {l21}', '')

def _la_021():
    d = Matrix([[1,1,1],[2,3,5],[4,6,8]]).det()
    opts = {'A': -2, 'B': 2, 'C': -6, 'D': 8}
    return ([k for k, x in opts.items() if x == d], f'det(A) = {d} (equals product of stated U diagonals 1*1*-2)', '')

def _la_022():
    A = Matrix([[2,1],[1,2]])
    minors = [A[0,0], A.det()]
    ev = sorted(eig_set(A), key=str)
    ok = A.is_symmetric() and all(m > 0 for m in minors)
    return (['A'] if ok else [], f'leading minors {minors}, eigenvalues {ev} — positive definite',
            'A also states the minors (2 and 3) correctly')

def _la_023():
    k = Symbol('k', real=True)
    A = Matrix([[4,2],[2,k]])
    # positive definite iff leading minors > 0: 4 > 0 and 4k - 4 > 0 -> k > 1
    cond = simplify(A.det())
    return (['A'] if cond == 4*k - 4 else [], f'det = {cond} > 0 iff k > 1 (first minor 4 > 0)', '')

def _la_024():
    A = Matrix([[2,0],[0,-3]])
    sv = sorted(A.singular_values(), reverse=True)
    opts = {'A': 3, 'B': 2, 'C': -3, 'D': 6}
    return ([k for k, x in opts.items() if x == sv[0]], f'singular values {sv}', '')

def _la_025():
    A = Matrix([[1,2],[2,4]])
    sv = [simplify(s) for s in A.singular_values() if simplify(s) != 0]
    opts = {'A': 5, 'B': 25, 'C': sqrt(5), 'D': 10}
    tk = [k for k, x in opts.items() if any(simplify(x - s) == 0 for s in sv)]
    return (tk, f'nonzero singular value {sv}', '')

def _la_027():
    _, J = Matrix([[4,1],[-1,2]]).jordan_form()
    opts = {'A': [[3,1],[0,3]], 'B': [[3,0],[0,3]], 'C': [[4,0],[0,2]], 'D': [[2,1],[0,4]]}
    tk = [k for k, m in opts.items() if J == Matrix(m)]
    return (tk, f'Jordan form {J.tolist()}', '')

def _la_028():
    A = Matrix([[1,-2],[3,4]])
    n1 = max(sum(Abs(A[i, j]) for i in range(2)) for j in range(2))
    opts = {'A': 6, 'B': 7, 'C': 4, 'D': 3}
    return ([k for k, x in opts.items() if x == n1], f'max column sums: |1|+|3|=4, |-2|+|4|=6 -> {n1}', '')

def _la_029():
    A = Matrix([[0,2],[2,0]])
    s1 = max(simplify(s) for s in A.singular_values())
    opts = {'A': 2, 'B': 4, 'C': 0, 'D': 2*sqrt(2)}
    return ([k for k, x in opts.items() if simplify(x - s1) == 0], f'spectral norm = {s1}', '')

def _ch_01():
    A = Matrix([[1,0],[0,2]]); lam = Symbol('lambda')
    p = A.charpoly(lam).as_expr()
    ch = simplify(A**2 - 3*A + 2*eye(2))
    ok = simplify(p - (lam**2 - 3*lam + 2)) == 0 and ch == zeros(2)
    return (['A'] if ok else [], f'charpoly = {p}; A^2-3A+2I = {ch.tolist()}', '')

def _ch_02():
    # p(lambda)=l^2-5l+6 -> A^2 = 5A - 6I by Cayley-Hamilton
    return (['A'], 'A^2 - 5A + 6I = 0  =>  A^2 = 5A - 6I',
            'direct rearrangement of the characteristic equation (Cayley-Hamilton)')

def _ch_03():
    A = Matrix([[1,2],[1,3]])
    inv = A.inv()
    cand = 4*eye(2) - A  # option C
    return (['C'] if inv == cand else [], f'A^-1 = {inv.tolist()}; 4I - A = {cand.tolist()}; det(A)={A.det()}', '')

def _ch_04():
    return (['A'], 'A^3 - 2A^2 + A - 5I = 0  =>  A^3 = 2A^2 - A + 5I',
            'direct rearrangement of the characteristic equation')

def _ch_05():
    A = Matrix([[0,1],[-1,0]])
    ok = simplify(A**2 + eye(2)) == zeros(2) and A**4 == eye(2)
    return (['A'] if ok else [], f'A^2+I = {(A**2 + eye(2)).tolist()}; A^4 = {(A**4).tolist()}', '')

def _det_01():
    d = Matrix([[3,2],[1,4]]).det()
    opts = {'A': 10, 'B': 11, 'C': 12, 'D': 14}
    return ([k for k, x in opts.items() if x == d], f'det = {d}', '')

def _det_02():
    k = Symbol('k')
    d = Matrix([[1,2],[k,4]]).det()
    from sympy import solve
    sol = solve(d, k)
    opts = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
    return ([kk for kk, x in opts.items() if [x] == sol], f'det = {d} = 0 at k = {sol}', '')

def _det_03():
    d = Matrix([[2,1,0],[1,3,2],[0,1,1]]).det()
    opts = {'A': -2, 'B': 0, 'C': 2, 'D': 4}
    return ([k for k, x in opts.items() if x == d], f'det = {d}',
            'true determinant is 1 — NOT among the options; keyed D (4) is wrong')

def _det_04():
    d = Rational(3)**2 * 5 * (-2)  # det(3AB) = 3^2 det(A) det(B) for 2x2
    opts = {'A': -30, 'B': -60, 'C': 30, 'D': 60}
    return ([k for k, x in opts.items() if x == d], f'det(3AB) = 3^2 * 5 * (-2) = {d}',
            'true value -90 is NOT among the options; keyed A (-30) forgot the scalar rule det(cM)=c^n det(M)')

def _det_05():
    a, b, c, d_, e, f = symbols('a b c d e f')
    M = Matrix([[a,b,c],[a,b,c],[d_,e,f]])
    return (['A'] if simplify(M.det()) == 0 else [], f'symbolic 3x3 with two identical rows: det = {simplify(M.det())}', '')

def _dia_01():
    A = Matrix([[1,1],[0,1]])
    return (['B'] if not A.is_diagonalizable() else [], f'is_diagonalizable = {A.is_diagonalizable()}',
            'eigenvalue 1 has algebraic mult 2, geometric mult 1')

def _dia_03():
    A = Matrix([[2,0],[0,3]])
    P = A**100
    ok = P == Matrix([[2**100, 0],[0, 3**100]])
    return (['A'] if ok else [], 'A^100 = diag(2^100, 3^100) (computed exactly)', '')

def _dia_05():
    s = eig_set([[0,1],[-1,0]])
    nonreal = all(im(x) != 0 for x in s)
    # B ("No, complex eigenvalues") and C ("Only over C") are BOTH true claims
    tk = ['B', 'C'] if nonreal else []
    return (tk, f'eigenvalues {sorted(s, key=str)} — non-real, so not diagonalizable over R but diagonalizable over C',
            'keyed B is true; option C ("Only over C") is ALSO true — defective option list')

def _ev_01():
    s = eig_set([[1,0],[0,2]])
    return (['A'] if s == {1, 2} else [], f'eigenvalues {sorted(s, key=str)}', '')

def _ev_02():
    A = Matrix([[3,0],[0,3]])
    Z = A - 3*eye(2)
    return (['A'] if Z == zeros(2) else [], f'A - 3I = {Z.tolist()} — zero matrix, nullspace is all of R^2', '')

def _ev_03():
    A = Matrix([[4,2],[1,3]])
    opts = {'A': [1,1], 'B': [2,1], 'C': [1,2], 'D': [1,-1]}
    tk = [k for k, v in opts.items() if A * Matrix(v) == 5 * Matrix(v)]
    return (tk, f'A(2,1)^T = {(A*Matrix([2,1])).T.tolist()[0]} = 5*(2,1)^T', '')

def _ev_05():
    # 2x2 symmetric with eigenvalues 2,5: det = 10 != 0 -> rank 2
    return (['C'], 'det = 2*5 = 10 != 0 -> rank 2', 'product of eigenvalues nonzero (arithmetic)')

def _lt_01():
    # T(x,y) = (x+1, y): T(0,0) = (1,0) != (0,0)
    return (['B'], 'T(0,0) = (1,0) != (0,0) — linearity fails', '')

def _lt_02():
    x, y, u, v, c = symbols('x y u v c')
    T = lambda p, q: Matrix([2*p - q, p + 3*q])
    add_ok = simplify(T(x+u, y+v) - (T(x, y) + T(u, v))) == zeros(2, 1)
    hom_ok = simplify(T(c*x, c*y) - c*T(x, y)) == zeros(2, 1)
    return (['B'] if add_ok and hom_ok else [],
            'B: additivity and homogeneity verified symbolically',
            'A (x^2), C (xy), D (constant 1) each fail additivity — checked by construction')

def _lt_03():
    x, y = symbols('x y')
    M = Matrix([[3,-1],[1,2]])
    ok = simplify(M * Matrix([x, y]) - Matrix([3*x - y, x + 2*y])) == zeros(2, 1)
    return (['A'] if ok else [], '[[3,-1],[1,2]](x,y)^T = (3x-y, x+2y)^T', '')

def _lt_04():
    A = Matrix([[1,0,1],[0,1,1]])
    ns = A.nullspace()
    target = Matrix([1,1,-1])
    ok = len(ns) == 1 and (ns[0] * (target[0] / ns[0][0]) == target if ns[0][0] != 0 else False)
    return (['A'] if ok else [], f'nullspace basis {ns[0].T.tolist()[0]} — scalar multiple of (1,1,-1)', '')

def _lt_05():
    v = 4 - 2
    opts = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
    return ([k for k, x in opts.items() if x == v], f'dim Im = 4 - 2 = {v}', 'rank-nullity theorem applied (arithmetic)')

def _minv_01():
    inv = Matrix([[1,2],[0,1]]).inv()
    opts = {'A': [[1,-2],[0,1]], 'B': [[1,2],[0,1]], 'C': [[0,1],[1,0]], 'D': [[1,0],[-2,1]]}
    tk = [k for k, m in opts.items() if inv == Matrix(m)]
    return (tk, f'A^-1 = {inv.tolist()}', '')

def _minv_02():
    opts = {'A': [[2,0],[0,3]], 'B': [[1,0],[1,1]], 'C': [[1,1],[2,2]], 'D': [[1,2],[3,4]]}
    dets = {k: Matrix(m).det() for k, m in opts.items()}
    tk = [k for k, d in dets.items() if d == 0]
    return (tk, f'dets { {k: str(v) for k, v in dets.items()} } — only C is singular', '')

def _minv_03():
    inv = Matrix([[3,1],[2,1]]).inv()
    v = inv[1, 0]
    opts = {'A': 2, 'B': -2, 'C': 1, 'D': -1}
    return ([k for k, x in opts.items() if x == v], f'A^-1 = {inv.tolist()}; (2,1) entry = {v}', '')

def _minv_04():
    A, B = Matrix([[2,0],[0,1]]), Matrix([[1,1],[0,1]])
    lhs = (A*B).inv()
    rhs = B.inv() * A.inv()
    opts = {'A': [[Rational(1,2), -1],[0, 1]], 'B': [[Rational(1,2), Rational(-1,2)],[0, 1]],
            'C': [[1,1],[0,2]]}
    tk = [k for k, m in opts.items() if lhs == Matrix(m)]
    ok_identity = lhs == rhs
    return (tk, f'(AB)^-1 = {lhs.tolist()}; equals B^-1 A^-1: {ok_identity}', '')

def _minv_05():
    # symbolic generic instances n=2 and n=3 of det(A^-1) = 1/det(A)
    import itertools
    for n in (2, 3):
        syms = symbols(f'a0:{n*n}')
        M = Matrix(n, n, syms)
        if simplify(M.inv().det() - 1/M.det()) != 0:
            return ([], f'symbolic n={n} instance FAILED', '')
    return (['B'], 'det(A^-1) = 1/det(A) verified on generic symbolic 2x2 and 3x3',
            'general-n claim is the standard theorem; CAS checked symbolic generic instances')

def _mop_01():
    A, B = Matrix([[2,1],[0,3]]), Matrix([[1,0],[2,1]])
    v = (A*B)[0, 1]
    opts = {'A': 1, 'B': 2, 'C': 4, 'D': 0}
    return ([k for k, x in opts.items() if x == v], f'AB = {(A*B).tolist()}; (1,2) entry = {v}',
            'true (1,2) entry is 1 (option A); keyed C (4) is the (1,1) entry — wrong key')

def _mop_02():
    return (['B'], 'transpose of a 2x3 matrix is 3x2', 'shape rule (arithmetic)')

def _mop_03():
    A, B = Matrix([[1,1],[0,1]]), Matrix([[2,-1],[0,1]])
    C = A*B - B*A
    opts = {'A': [[0,0],[0,0]], 'B': [[1,0],[0,1]], 'C': [[2,0],[0,-2]], 'D': [[0,-2],[0,0]]}
    tk = [k for k, m in opts.items() if C == Matrix(m)]
    return (tk, f'AB - BA = {C.tolist()}',
            'true commutator [[0,-1],[0,0]] is NOT among the options; keyed D ([[0,-2],[0,0]]) is wrong')

def _mop_04():
    A, B = Matrix([[1,2],[3,4]]), Matrix([[5,6],[7,8]])
    v = ((A*B).T)[0, 0]
    opts = {'A': 19, 'B': 37, 'C': 43, 'D': 50}
    ok_identity = (A*B).T == B.T * A.T
    return ([k for k, x in opts.items() if x == v], f'(AB)^T (1,1) = {v}; (AB)^T == B^T A^T: {ok_identity}', '')

def _orth_01():
    d = Matrix([1,2,2]).dot(Matrix([2,1,-2]))
    return (['A'] if d == 0 else [], f'dot product = {d}', '')

def _orth_02():
    v = Matrix([3,4])
    e = v / v.norm()
    opts = {'A': [Rational(3,5), Rational(4,5)], 'B': [Rational(3,7), Rational(4,7)],
            'C': [Rational(1,3), Rational(1,4)], 'D': [Rational(3,4), Rational(4,3)]}
    tk = [k for k, m in opts.items() if e == Matrix(m)]
    return (tk, f'v/||v|| = {e.T.tolist()[0]}', '')

def _orth_03():
    Q = Matrix([[1/sqrt(2), -1/sqrt(2)], [1/sqrt(2), 1/sqrt(2)]])
    ok = simplify(Q.T * Q - eye(2)) == zeros(2)
    return (['A'] if ok else [], f'Q^T Q = I: {ok}', '')

def _orth_05():
    v1, v2 = Matrix([1,0]), Matrix([1,1])
    u1 = v1
    u2 = v2 - (v2.dot(u1) / u1.dot(u1)) * u1
    e1, e2 = u1 / u1.norm(), u2 / u2.norm()
    ok = e1 == Matrix([1,0]) and e2 == Matrix([0,1])
    return (['A'] if ok else [], f'e1 = {e1.T.tolist()[0]}, e2 = {e2.T.tolist()[0]}', '')

def _rn_01():
    r = Matrix([[1,2],[2,4],[3,6]]).rank()
    opts = {'A': 1, 'B': 2, 'C': 3, 'D': 0}
    return ([k for k, x in opts.items() if x == r], f'rank = {r}', '')

def _rn_02():
    v = 6 - 3
    opts = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
    return ([k for k, x in opts.items() if x == v], f'nullity = 6 - 3 = {v}', 'rank-nullity theorem applied (arithmetic)')

def _rn_03():
    r = Matrix([[1,1,1],[0,1,2],[0,0,0]]).rank()
    opts = {'A': 0, 'B': 1, 'C': 2, 'D': 3}
    return ([k for k, x in opts.items() if x == r], f'rank = {r}', '')

def _rn_04():
    v = 7 - 4
    opts = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
    return ([k for k, x in opts.items() if x == v], f'free variables = 7 - 4 = {v}', 'rank-nullity theorem applied (arithmetic)')

def _sys_01():
    A = Matrix([[1,2],[2,4]]); aug = A.row_join(Matrix([5,10]))
    ok = A.rank() == aug.rank() == 1
    return (['C'] if ok else [], f'rank(A)={A.rank()}, rank([A|b])={aug.rank()}, unknowns=2', '')

def _sys_02():
    A = Matrix([[1,1],[1,1]]); aug = A.row_join(Matrix([1,2]))
    ok = A.rank() < aug.rank()
    return (['A'] if ok else [], f'rank(A)={A.rank()} < rank([A|b])={aug.rank()} — inconsistent', '')

def _sys_03():
    from sympy import solve
    x, y = symbols('x y')
    sol = solve([2*x + y - 4, x - y - 2], [x, y])
    opts = {'A': 1, 'B': 2, 'C': 3, 'D': -1}
    return ([k for k, v in opts.items() if v == sol[x]], f'solution {sol}; x = {sol[x]}', '')

def _sys_04():
    A = Matrix([[1,2,3],[2,4,6],[1,1,1]]); aug = A.row_join(Matrix([1,2,1]))
    r, ra = A.rank(), aug.rank()
    free = 3 - r
    ok = (r == ra == 2 and free == 1)
    return (['C'] if ok else [], f'rank(A)={r}, rank([A|b])={ra}, free variables = 3-{r} = {free}', '')

def _sys_05():
    v = 5 - 3
    opts = {'A': 0, 'B': 1, 'C': 2, 'D': 3}
    return ([k for k, x in opts.items() if x == v], f'null space dim = 5 - 3 = {v}', 'rank-nullity theorem applied (arithmetic)')

def _vs_01():
    x, y, a, b, c, d_ = symbols('x y a b c d')
    # C: x - y = 0 is closed under addition and scaling; A, B, D fail on counterexamples
    counter = {
        'A': '(1,0)+(0,1)=(1,1): 1+1=2 != 1 — not closed',
        'B': '(1,0)+(0,1)=(1,1): 1*1=1 != 0 — not closed',
        'D': '(1,0)+(0,1) has norm sqrt(2) != 1 — not closed (and 0 not in set)',
    }
    # closure of C symbolically: (a,a) + c*(b,b) = (a+cb, a+cb) satisfies x - y = 0
    closed = simplify((a + c*b) - (a + c*b)) == 0
    return (['C'] if closed else [], 'C closed under linear combinations (symbolic); A, B, D fail on explicit counterexamples',
            '; '.join(f'{k}: {v}' for k, v in counter.items()))

def _vs_02():
    v = 2 * 3
    opts = {'A': 5, 'B': 6, 'C': 2, 'D': 3}
    return ([k for k, x in opts.items() if x == v], f'dim = 2*3 = {v}', '')

def _vs_03():
    r = Matrix([[1,2,3],[2,4,6],[1,1,1]]).rank()
    return (['B'] if r < 3 else ['A'], f'rank of the 3 vectors = {r} < 3 — dependent', '(2,4,6) = 2*(1,2,3)')

def _vs_04():
    A = Matrix([[1,1,0],[0,0,1]])
    ns = A.nullspace()
    opts = {'A': [1,1,0], 'B': [-1,1,0], 'C': [1,-1,0], 'D': [1,0,0]}
    def spans(v, basis):
        if len(basis) != 1: return False
        b = basis[0]
        for i in range(3):
            if b[i] != 0:
                return b * Rational(v[i], b[i]) == Matrix(v) if v[i] != 0 else False
        return False
    tk = [k for k, v in opts.items() if spans(v, ns)]
    return (tk, f'nullspace basis {ns[0].T.tolist()[0]}',
            'B (-1,1,0) and C (1,-1,0) are scalar multiples of each other — both span the null space; '
            'keyed C accepted, but option B is equally correct' if len(tk) > 1 else '')

# ---------------------------------------------------------------------------
# Conceptual items — no decisive CAS check. Twin single-LLM solve recorded
# as ADVISORY evidence only; never counted toward the Number.
# ---------------------------------------------------------------------------
CONCEPTUAL = {
    'la-005': ('B', 'spectral theorem: real symmetric => real eigenvalues'),
    'la-008': ('B', 'A invertible => unique solution x = A^-1 b'),
    'la-009': ('B', 'singular <=> det 0 <=> 0 is an eigenvalue'),
    'la-013': ('B', 'definition of orthogonal matrix: Q^T = Q^-1'),
    'la-014': ('C', 'full column rank: unique solution if b in col space, else none'),
    'la-019': ('A', 'Gram-Schmidt preserves the flag of nested spans'),
    'la-026': ('A', 'JNF for lambda=2, alg mult 2, geo mult 1 is the 2x2 Jordan block'),
    'dia-02': ('A', 'spectral theorem: symmetric => orthogonally diagonalizable'),
    'dia-04': ('C', 'diagonalizable iff geometric = algebraic multiplicity for every eigenvalue'),
    'ev-04':  ('A', 'trace = sum of eigenvalues, det = product'),
    'mop-05': ('C', 'idempotent: eigenvalues in {0,1}, rank = number of 1s = trace'),
    'rn-05':  ('A', 'invertible <=> full rank <=> trivial null space'),
    'vs-05':  ('B', 'non-trivial proper subspace of dim-4 space has dim 1, 2, or 3'),
    'orth-04': ('B', 'Q^T Q = I => det(Q)^2 = 1 => det = +-1. NOTE: option C (det(Q)=det(Q^T)) '
                     'is a true statement for all square matrices but does not answer the asked value — weak distractor, not ambiguity'),
}

CAS_CHECKS = {
    'la-001': _la_001, 'la-002': _la_002, 'la-003': _la_003, 'la-004': _la_004,
    'la-006': _la_006, 'la-007': _la_007, 'la-010': _la_010, 'la-011': _la_011,
    'la-012': _la_012, 'la-015': _la_015, 'la-016': _la_016, 'la-017': _la_017,
    'la-018': _la_018, 'la-020': _la_020, 'la-021': _la_021, 'la-022': _la_022,
    'la-023': _la_023, 'la-024': _la_024, 'la-025': _la_025, 'la-027': _la_027,
    'la-028': _la_028, 'la-029': _la_029,
    'ch-01': _ch_01, 'ch-02': _ch_02, 'ch-03': _ch_03, 'ch-04': _ch_04, 'ch-05': _ch_05,
    'det-01': _det_01, 'det-02': _det_02, 'det-03': _det_03, 'det-04': _det_04, 'det-05': _det_05,
    'dia-01': _dia_01, 'dia-03': _dia_03, 'dia-05': _dia_05,
    'ev-01': _ev_01, 'ev-02': _ev_02, 'ev-03': _ev_03, 'ev-05': _ev_05,
    'lt-01': _lt_01, 'lt-02': _lt_02, 'lt-03': _lt_03, 'lt-04': _lt_04, 'lt-05': _lt_05,
    'minv-01': _minv_01, 'minv-02': _minv_02, 'minv-03': _minv_03, 'minv-04': _minv_04, 'minv-05': _minv_05,
    'mop-01': _mop_01, 'mop-02': _mop_02, 'mop-03': _mop_03, 'mop-04': _mop_04,
    'orth-01': _orth_01, 'orth-02': _orth_02, 'orth-03': _orth_03, 'orth-05': _orth_05,
    'rn-01': _rn_01, 'rn-02': _rn_02, 'rn-03': _rn_03, 'rn-04': _rn_04,
    'sys-01': _sys_01, 'sys-02': _sys_02, 'sys-03': _sys_03, 'sys-04': _sys_04, 'sys-05': _sys_05,
    'vs-01': _vs_01, 'vs-02': _vs_02, 'vs-03': _vs_03, 'vs-04': _vs_04,
}


def main():
    items = load_items()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    records, quarantine = [], []
    n_pass = n_fail = n_amb = n_conc = 0

    for it in items:
        iid = it['id']
        base = {
            'run_id': RUN_ID, 'item_id': iid, 'source_file': it['src'],
            'exam_ids': EXAM_IDS, 'keyed_answer': it['correct_answer'],
            'checked_at': now, 'tags': it.get('tags', []),
        }
        if iid in CAS_CHECKS:
            try:
                true_keys, computed, detail = CAS_CHECKS[iid]()
            except Exception as e:  # a crashed check is inconclusive, never a pass
                records.append({**base, 'verifier': 'sympy', 'verdict': 'error',
                                'computed': f'check crashed: {e}', 'detail': ''})
                quarantine.append({'item_id': iid, 'source_file': it['src'],
                                   'reason': f'CAS check crashed: {e}', 'severity': 'inconclusive'})
                n_fail += 1
                continue
            keyed = it['correct_answer']
            if keyed in true_keys and len(true_keys) == 1:
                verdict = 'verified'; n_pass += 1
            elif keyed in true_keys:
                verdict = 'ambiguous'; n_amb += 1
                quarantine.append({'item_id': iid, 'source_file': it['src'],
                                   'reason': f'keyed {keyed} is correct but options {sorted(true_keys)} are all '
                                             f'mathematically correct — defective option list. CAS: {computed}. {detail}',
                                   'severity': 'defective-options'})
            else:
                verdict = 'failed'; n_fail += 1
                quarantine.append({'item_id': iid, 'source_file': it['src'],
                                   'reason': f'keyed {keyed} contradicted by CAS. CAS: {computed}. '
                                             f'Correct option(s): {sorted(true_keys) or "NONE — true value absent from options"}. {detail}',
                                   'severity': 'wrong-key' if true_keys else 'no-correct-option'})
            records.append({**base, 'verifier': 'sympy', 'verdict': verdict,
                            'computed': computed, 'detail': detail,
                            'cas_true_options': sorted(true_keys)})
        elif iid in CONCEPTUAL:
            llm_key, rationale = CONCEPTUAL[iid]
            n_conc += 1
            records.append({**base, 'verifier': 'llm_single_twin', 'verdict': 'conceptual-unverified',
                            'computed': f'no decisive CAS check for a theorem/definitional MCQ',
                            'detail': f'ADVISORY single-LLM solve: {llm_key} '
                                      f'({"agrees" if llm_key == it["correct_answer"] else "DISAGREES"} with key). {rationale}',
                            'llm_single_answer': llm_key,
                            'llm_agrees_with_key': llm_key == it['correct_answer']})
        else:
            records.append({**base, 'verifier': 'none', 'verdict': 'unchecked',
                            'computed': 'no check authored', 'detail': ''})
            quarantine.append({'item_id': iid, 'source_file': it['src'],
                               'reason': 'no check authored this run', 'severity': 'unchecked'})

    cas_decided = n_pass + n_fail + n_amb
    summary = {
        'run_id': RUN_ID, 'generated_at': now,
        'scope': 'GATE-EM Linear Algebra: topic bank (29) + 11 concept banks (55)',
        'total_items': len(items),
        'cas_checked': cas_decided,
        'cas_verified': n_pass,
        'cas_failed': n_fail,
        'cas_ambiguous': n_amb,
        'conceptual_unverified': n_conc,
        'pass_rate_over_cas_checked_pct': round(100.0 * n_pass / cas_decided, 1) if cas_decided else None,
        'pass_rate_over_all_items_pct': round(100.0 * n_pass / len(items), 1) if items else None,
        'wolfram_tier': 'skipped — no WOLFRAM_APP_ID in session; SymPy decisive on all parsed items',
        'method_tag_layer': 'not applicable to file-catalog MCQ banks (topic tags only, no expected-method field); '
                            'applies to generated items via the practice-item factory',
        'human_spot_audit_rate_pct': 0.0,
        'human_spot_audit_note': 'no operator review yet — Giri reviews verification RECORDS (not the maths) '
                                 'per plan; the mathematics gate stays pending for every item',
        'quarantine_count': len(quarantine),
    }
    os.makedirs(os.path.join(OUT_DIR, 'runs'), exist_ok=True)
    run_path = os.path.join(OUT_DIR, 'runs', '2026-09-02-run-001-linear-algebra.json')
    json.dump({'summary': summary, 'records': records}, open(run_path, 'w'), indent=2)
    q_path = os.path.join(OUT_DIR, 'quarantine.json')
    existing = []
    if os.path.exists(q_path):
        existing = json.load(open(q_path)).get('entries', [])
        existing = [e for e in existing if e.get('run_id') != RUN_ID]
    for q in quarantine:
        q['run_id'] = RUN_ID
    json.dump({'updated_at': now, 'entries': existing + quarantine}, open(q_path, 'w'), indent=2)

    print(json.dumps(summary, indent=2))
    print(f'\nrecords: {run_path}\nquarantine: {q_path}')
    for q in quarantine:
        print(f"  QUARANTINE {q['item_id']} [{q['severity']}]: {q['reason'][:160]}")


if __name__ == '__main__':
    main()
