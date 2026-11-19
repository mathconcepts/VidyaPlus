#!/usr/bin/env python3
"""
ENG-0 AUDIT — run #2: Calculus (2026-09-03, overnight worker)

Second audit run over the committed GATE-EM bank (CEO plan §5.2 ENG-0),
first slice of the 28-mark common block: the 15-item calculus topic bank
(topics/02-calculus/mcqs.json) plus the 95 items across the 19 calculus
concept banks (concepts/*/mcqs.json with topic == "calculus", matched
case-insensitively). 110 items total. The rest of the block (ODEs,
complex variables, probability-statistics) is runs #3-#4 per the
overnight queue.

Tier used: SymPy (authoring-time CAS check — same deployment shape as
run #1; this script never runs on a request path). Wolfram tier: SKIPPED
this run — no WOLFRAM_APP_ID in the session env; SymPy reached a decisive
verdict on every item it could parse.

For each item a check was AUTHORED (by the overnight twin session) that
recomputes the asked quantity from the item's own data with SymPy and
maps the computed value onto the option list. Where an option is an
expression (a derivative, an antiderivative, a partial-fraction form),
the check compares expressions symbolically; two options that simplify
to the same function (e.g. ln(x) vs ln|x| on x>0, cos(x)/sin(x) vs
cot(x)) are BOTH counted correct, which quarantines the item as
defective-options even when the key is right.

Verdicts — identical rules to run #1 (honest-states law, plan R9):
  verified / failed / ambiguous / conceptual — see run-001 header.

The `mathematics` gate stays operator-decided; these records are
EVIDENCE, committed as files under data/verification/eng0/ (no Postgres
yet, pre-ENG-1), replayable into content_gate_ledger.

Method-tag second layer: NOT RUN — same scope note as run #1 (file-catalog
banks carry no expected-method field).

NOTE (run #3, 2026-09-04): this script transcribes the ORIGINAL option
lists as they stood on 2026-09-03 and is the historical record of that
run. The 13 items it quarantined were fixed on 2026-09-04 and re-audited
by scripts/eng0/audit-run-003-quarantine-reaudit.py, which reads the
live item data. Re-running THIS script against the fixed bank will
report mismatches for those 13 items — that is expected: it audits the
old bank state.

Usage: python3 scripts/eng0/audit-run-002-calculus.py
Writes: data/verification/eng0/runs/2026-09-03-run-002-calculus.json
        data/verification/eng0/quarantine.json (appends run #2 entries)
Exit 0 always (the report is the product; a low number is published, not
suppressed — plan S14).
"""
import json, glob, os, datetime
from sympy import (Symbol, symbols, Rational, sqrt, pi, oo, E, I, exp, log, ln,
                   sin, cos, tan, sec, cot, Abs, sign, integrate, diff, limit,
                   simplify, expand, factor, solve, series, factorial, Sum,
                   Matrix, hessian, nsimplify, apart, together, idiff)

x, y, t, n, h = symbols('x y t n h')
k = Symbol('k', positive=True, integer=True)

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT_DIR = os.path.join(ROOT, 'data', 'verification', 'eng0')
RUN_ID = 'eng0-run-002-calculus'
EXAM_IDS = ['gate-engineering-maths']  # shared corpus: JEE re-tag lands with ENG-10


def load_items():
    items = []
    files = ['data/courses/gate-em/topics/02-calculus/mcqs.json'] + sorted(
        glob.glob(os.path.join(ROOT, 'data/courses/gate-em/concepts/*/mcqs.json')))
    for f in files:
        p = f if os.path.isabs(f) else os.path.join(ROOT, f)
        d = json.load(open(p))
        if not isinstance(d, dict):
            continue
        if str(d.get('topic', '')).lower() == 'calculus' or '02-calculus' in p:
            rel = os.path.relpath(p, ROOT)
            for q in d['questions']:
                items.append({'src': rel, **q})
    return items


def match_value(v, opts):
    """Option letters whose value equals v exactly (symbolic)."""
    out = []
    for kk, cand in opts.items():
        try:
            if simplify(cand - v) == 0:
                out.append(kk)
        except Exception:
            if cand == v:
                out.append(kk)
    return out


def match_expr(target, opts, var=x):
    """Option letters whose expression is identically the target."""
    return [kk for kk, cand in opts.items() if simplify(cand - target) == 0]


def match_antideriv(integrand, opts, var=x, domain_positive=False):
    """Option letters that are valid antiderivatives of integrand (d/dx == integrand).
    domain_positive: simplify under x > 0 (so ln|x| == ln x there)."""
    out = []
    xv = Symbol('x', positive=True) if domain_positive else var
    for kk, cand in opts.items():
        c = cand.subs(var, xv) if domain_positive else cand
        f = integrand.subs(var, xv) if domain_positive else integrand
        try:
            if simplify(diff(c, xv) - f) == 0:
                out.append(kk)
        except Exception:
            pass
    return out


# ---------------------------------------------------------------------------
# Authored checks — one per item; returns (true_keys, computed, detail).
# ---------------------------------------------------------------------------

def _ca_001():
    v = limit(sin(3*x)/(5*x), x, 0)
    return (match_value(v, {'A': Rational(3, 5), 'B': Rational(5, 3), 'C': 1, 'D': 0}),
            f'limit = {v}', '')

def _ca_002():
    c3 = exp(2*x).series(x, 0, 4).coeff(x, 3)
    return (match_value(c3, {'A': Rational(4, 3), 'B': Rational(8, 3), 'C': Rational(2, 3), 'D': 4}),
            f'Maclaurin x^3 coefficient of e^(2x) = 2^3/3! = {c3}', '')

def _ca_003():
    v = integrate(x*exp(x), (x, 0, 1))
    return (match_value(v, {'A': 1, 'B': E - 1, 'C': E, 'D': 2}), f'integral = {v}', '')

def _ca_004():
    f = x**2 + y**2 - x*y
    crits = solve([diff(f, x), diff(f, y)], [x, y], dict=True)
    H = hessian(f, (x, y))
    d, fxx = H.det(), H[0, 0]
    ok = len(crits) == 1 and crits[0] == {x: 0, y: 0} and d > 0 and fxx > 0
    return (['B'] if ok else [], f'critical point {crits}; Hessian det = {d} > 0, f_xx = {fxx} > 0 — local minimum', '')

def _ca_005():
    v = integrate(x + y, (x, 0, 1), (y, 0, 1))
    return (match_value(v, {'A': Rational(1, 2), 'B': 1, 'C': 2, 'D': Rational(3, 2)}), f'double integral = {v}', '')

def _ca_006():
    v = limit((exp(x) - 1 - x)/x**2, x, 0)
    return (match_value(v, {'A': 0, 'B': 1, 'C': Rational(1, 2), 'D': 2}), f'limit = {v}', '')

def _ca_007():
    v = diff(log(1 + x), x, 3).subs(x, 0)
    return (match_value(v, {'A': 1, 'B': 2, 'C': -2, 'D': Rational(1, 6)}), f"f'''(0) = {v}", '')

def _ca_008():
    f = x**3 - 3*x + 2
    crits = sorted(solve(diff(f, x), x))
    maxima = [c for c in crits if diff(f, x, 2).subs(x, c) < 0]
    opts = {'A': 1, 'B': -1, 'C': 0, 'D': 2}
    tk = [kk for kk, v in opts.items() if v in maxima] if len(maxima) == 1 else []
    return (tk, f"critical points {crits}; f''<0 at {maxima} — local maximum there", '')

def _ca_009():
    v = integrate(sin(x)**2, (x, 0, pi))
    return (match_value(v, {'A': pi/4, 'B': pi/2, 'C': pi, 'D': 0}), f'integral = {v}', '')

def _ca_010():
    f = x**2*y + sin(x*y)
    fx, fy = diff(f, x), diff(f, y)
    opts = {'A': (2*x*y, x**2),
            'B': (2*x*y + y*cos(x*y), x**2 + x*cos(x*y)),
            'C': (2*x*y + cos(x*y), x**2 + cos(x*y)),
            'D': (0 + y*sin(x*y), x**2)}  # D transcribed: dx-coeff y*sin(xy), dy-coeff x^2
    tk = [kk for kk, (a, b) in opts.items() if simplify(a - fx) == 0 and simplify(b - fy) == 0]
    return (tk, f'f_x = {fx}, f_y = {fy}', '')

def _ca_011():
    c = solve(diff(x**2, x).subs(x, Symbol('c')) - Rational(9 - 1, 3 - 1), Symbol('c'))
    return (match_value(c[0], {'A': 1, 'B': 2, 'C': sqrt(3), 'D': 3}) if len(c) == 1 else [],
            f'2c = 4 -> c = {c}', '')

def _ca_012():
    v = integrate(x*exp(-x**2), (x, 0, oo))
    return (match_value(v, {'A': 0, 'B': Rational(1, 2), 'C': 1, 'D': sqrt(pi)/2}), f'integral = {v}', '')

def _ca_013():
    v = diff(diff(x**2*y**3, y), x)  # d^2f/dx dy = d/dx(df/dy); equals mixed partial by Clairaut
    return (match_expr(v, {'A': 6*x**2*y**2, 'B': 6*x*y**2, 'C': 2*y**3, 'D': 3*x**2*y**2}),
            f'mixed partial = {v} (Clairaut: both orders agree)', '')

def _ca_014():
    cont = limit(Abs(x), x, 0) == 0  # = f(0)
    ld = limit((Abs(0 + h) - 0)/h, h, 0, '-')
    rd = limit((Abs(0 + h) - 0)/h, h, 0, '+')
    ok = cont and ld != rd
    return (['B'] if ok else [], f'continuous at 0 (limit 0 = f(0)); left derivative {ld} != right derivative {rd}', '')

def _ca_015():
    v = integrate(x - x**2, (x, 0, 1))
    return (match_value(v, {'A': Rational(1, 6), 'B': Rational(1, 3), 'C': Rational(1, 2), 'D': 1}),
            f'area = int_0^1 (x - x^2) dx = {v}', '')

def _chr_01():
    d = diff(sin(3*x), x)
    return (match_expr(d, {'A': cos(3*x), 'B': 3*cos(3*x), 'C': 3*sin(3*x), 'D': cos(x)}), f"f' = {d}", '')

def _chr_02():
    d = diff(exp(2*x), x)
    return (match_expr(d, {'A': exp(2*x), 'B': 2*exp(2*x), 'C': exp(2*x) + 2, 'D': 2*exp(x)}), f"f' = {d}", '')

def _chr_03():
    d = diff(sqrt(5*x + 2), x)
    return (match_expr(d, {'A': 1/(2*sqrt(5*x + 2)), 'B': 5/sqrt(5*x + 2),
                           'C': 5/(2*sqrt(5*x + 2)), 'D': 1/(2*sqrt(5))}), f"f' = {d}", '')

def _chr_04():
    d = diff(log(sin(x)), x)
    tk = match_expr(d, {'A': 1/sin(x), 'B': cos(x)/sin(x), 'C': 1/cos(x), 'D': cot(x)})
    return (tk, f"f' = {d} = cot(x)",
            'options B (cos(x)/sin(x)) and D (cot(x)) are the SAME function — defective option list')

def _chr_05():
    d = diff((x**2 + 3*x)**10, x).subs(x, 0)
    return (match_value(d, {'A': 0, 'B': 3, 'C': 300, 'D': 3**10}), f"f'(0) = {d}", '')

def _con_01():
    L = limit((x**2 - 4)/(x - 2), x, 2)
    finite = L.is_finite
    return (['B'] if finite else [],
            f'limit at 2 = {L} (finite) while f(2) is undefined (0/0) — removable discontinuity',
            'removable iff the two-sided limit exists finite and the point is not in the domain')

def _con_02():
    # continuity everywhere, checked per option
    a_bad = limit(1/x, x, 0, '+') != limit(1/x, x, 0, '-')  # and undefined at 0
    b_ok = limit(Abs(x), x, 0) == 0
    c_left = limit(x, x, 1, '-'); c_right = limit(2 - x, x, 1, '+'); c_val = 1
    c_ok = c_left == c_right == c_val  # both linear pieces continuous elsewhere
    d_bad = limit(tan(x), x, pi/2, '-') == oo
    tk = []
    if b_ok: tk.append('B')
    if c_ok: tk.append('C')
    return (tk if (a_bad and d_bad) else [],
            f'B: |x| continuous. C: piecewise pieces linear, left limit {c_left} = right limit {c_right} = f(1) = {c_val} at the seam — ALSO continuous everywhere. A (1/x at 0) and D (tan at pi/2) are not',
            'keyed B is correct but option C is a continuous-everywhere function too — defective option list')

def _con_03():
    a = Symbol('a')
    sol = solve(limit(x**2, x, 1, '-') - (a*1 + 2), a)
    return (match_value(sol[0], {'A': -1, 'B': 0, 'C': 1, 'D': -2}) if len(sol) == 1 else [],
            f'continuity at 1: 1 = a + 2 -> a = {sol}', '')

def _con_04():
    L = limit(sin(x)/x, x, 0)
    return (['A'] if L == 1 else [],
            f'limit at 0 = {L} (finite) while f(0) is undefined — removable discontinuity',
            'option D says "no discontinuity" — false as stated (f(0) is undefined), though the function can be extended; A is the accurate classification')

def _con_05():
    lp, lm = limit(1/x, x, 0, '+'), limit(1/x, x, 0, '-')
    return (['D'] if lp != lm else [],
            f'one-sided limits {lm} and {lp} differ (infinite) — no value of c makes f continuous', '')

def _def_01():
    v = integrate(3*x**2 + 2*x, (x, 0, 1))
    return (match_value(v, {'A': 1, 'B': 2, 'C': 3, 'D': 4}), f'integral = {v}', '')

def _def_02():
    v = integrate(sin(x), (x, 0, pi/2))
    return (match_value(v, {'A': 0, 'B': 1, 'C': pi/2, 'D': 2}), f'integral = {v}', '')

def _def_03():
    v = integrate(1/x, (x, 1, 2))
    return (match_value(v, {'A': log(2), 'B': log(Rational(1, 2)), 'C': E - 1, 'D': 1 - E}),
            f'integral = {v}', '')

def _def_04():
    v = integrate(x**3, (x, -1, 1))
    return (match_value(v, {'A': 0, 'B': 1, 'C': Rational(1, 2), 'D': 2}), f'integral = {v} (odd function, symmetric interval)', '')

def _def_05():
    v = integrate(exp(x), (x, 0, 1))
    return (match_value(v, {'A': E - 1, 'B': E, 'C': 1, 'D': E + 1}), f'area = {v}', '')

def _der_01():
    d = diff(x**5 + 3*x**3 - 2*x + 7, x)
    return (match_expr(d, {'A': 5*x**4 + 9*x**2 - 2, 'B': 5*x**4 + 3*x**2 - 2,
                           'C': x**4 + x**2 - 1, 'D': 5*x**5 + 9*x**3 - 2*x}), f"f' = {d}", '')

def _der_02():
    v = diff(exp(x)*cos(x), x).subs(x, 0)
    return (match_value(v, {'A': 1, 'B': -1, 'C': 0, 'D': E}), f"f'(0) = {v}", '')

def _der_03():
    d = diff(x**3/exp(x), x)
    return (match_expr(d, {'A': 3*x**2/exp(x), 'B': x**2*(3 - x)/exp(x),
                           'C': (x**3 - 3*x**2)/exp(x), 'D': x**2*(x - 3)/exp(x)}), f"f' = {simplify(d)}", '')

def _der_04():
    v = diff(tan(x), x).subs(x, pi/4)
    return (match_value(v, {'A': 1, 'B': 2, 'C': sqrt(2), 'D': 1/sqrt(2)}), f"sec^2(pi/4) = {v}", '')

def _der_05():
    v = diff(x**Rational(1, 3), x).subs(x, 8)
    return (match_value(v, {'A': Rational(1, 12), 'B': Rational(1, 6), 'C': Rational(1, 3), 'D': Rational(1, 4)}),
            f"f'(8) = {v}", '')

def _diff_01():
    def diffble_at0(f):
        ld = limit((f.subs(x, h) - f.subs(x, 0))/h, h, 0, '-')
        rd = limit((f.subs(x, h) - f.subs(x, 0))/h, h, 0, '+')
        return ld == rd and ld.is_finite
    res = {'A': diffble_at0(x**2), 'B': diffble_at0(x**3), 'C': diffble_at0(Abs(x)), 'D': diffble_at0(sin(x))}
    tk = [kk for kk, ok in res.items() if not ok]
    return (tk, f'differentiable at 0: {res} — only |x| is not', '')

def _diff_02():
    ld = limit(h*Abs(h)/h, h, 0, '-')
    rd = limit(h*Abs(h)/h, h, 0, '+')
    tk = match_value(ld, {'B': 0, 'C': 1, 'D': -1}) if ld == rd else ['A']
    return (tk, f"f'(0) via limit definition: left {ld} = right {rd} = 0", '')

def _diff_03():
    a, b = symbols('a b')
    sol = solve([1 - (a + b),                 # continuity at 1: 1^2 = a + b
                 2 - a], [a, b], dict=True)   # derivative match: 2x|_{x=1} = a
    opts = {'A': (2, 1), 'B': (2, -1), 'C': (1, 0), 'D': (-1, 2)}
    tk = [kk for kk, (av, bv) in opts.items() if sol and sol[0] == {a: av, b: bv}]
    return (tk, f'continuity: a+b=1; smoothness: a=2 -> {sol}', '')

def _diff_04():
    f = Abs(x - 1) + Abs(x - 2)
    bad = []
    for p in (Rational(1, 2), 1, Rational(3, 2), 2, Rational(5, 2)):
        ld = limit((f.subs(x, p + h) - f.subs(x, p))/h, h, 0, '-')
        rd = limit((f.subs(x, p + h) - f.subs(x, p))/h, h, 0, '+')
        if ld != rd:
            bad.append(p)
    return (match_value(len(bad), {'A': 0, 'B': 1, 'C': 2, 'D': 3}),
            f'non-differentiable points in (0,3): {bad} — count {len(bad)}', '')

def _id_01():
    r = Symbol('r', positive=True)
    dy = idiff(x**2 + y**2 - r**2, y, x)
    return (match_expr(dy, {'A': x/y, 'B': -y/x, 'C': -x/y, 'D': y/x}), f'dy/dx = {dy}', '')

def _id_02():
    c = Symbol('c')
    dy = idiff(x*y - c, y, x)
    return (match_expr(dy, {'A': y/x, 'B': -y/x, 'C': x/y, 'D': -x/y}), f'dy/dx = {dy}', '')

def _id_03():
    a = Symbol('a')
    dy = idiff(x**3 + y**3 - 3*a*x*y, y, x)
    opts = {'A': (a*y - x**2)/(y**2 - a*x), 'B': (x**2 - a*y)/(y**2 - a*x),
            'C': (3*x**2 - 3*a*y)/(3*y**2 - 3*a*x), 'D': (x**2 + a*y)/(y**2 + a*x)}
    return (match_expr(dy, opts), f'dy/dx = {simplify(dy)}', '')

def _id_04():
    d2 = idiff(x**2 + y**2 - 1, y, x, 2).subs({x: 0, y: 1})
    return (match_value(d2, {'A': 0, 'B': -1, 'C': 1}),
            f"d2y/dx2 at (0,1) = {d2}",
            'option D states the correct general formula -1/y^3 but is not the asked value at the point — weak distractor, not ambiguity (run-001 orth-04 precedent)')

def _id_05():
    dy = idiff(x**2 + x*y + y**2 - 7, y, x).subs({x: 1, y: 2})
    return (match_value(dy, {'A': Rational(-4, 5), 'B': Rational(-5, 4), 'C': Rational(4, 5), 'D': Rational(-2, 5)}),
            f'tangent slope at (1,2) = {dy}; line A carries this slope', '')

def _imp_01():
    v = integrate(1/x, (x, 1, oo))
    return (['C'] if v == oo else [], f'integral = {v} — diverges',
            'option D "ln(oo)" is not a real value; C is the correct evaluation')

def _imp_02():
    v = integrate(exp(-x), (x, 1, oo))
    return (match_value(v, {'A': 0, 'B': 1, 'C': exp(-1)}), f'integral = {v} = 1/e', '')

def _imp_03():
    v = integrate(x**Rational(-1, 2), (x, 1, oo))
    return (['B'] if v == oo else [], f'p = 1/2 <= 1: integral = {v} — diverges', '')

def _imp_04():
    v = integrate(1/sqrt(x), (x, 0, 1))
    return (match_value(v, {'A': 0, 'B': 1, 'C': 2}), f'integral = {v} (convergent despite the endpoint singularity)', '')

def _imp_05():
    v = integrate(exp(-x**2), (x, -oo, oo))
    return (match_value(v, {'A': 0, 'B': sqrt(pi), 'C': pi}), f'Gaussian integral = {v}', '')

def _int_01():
    f = 5*x**4 + 3*x**2 - 2
    opts = {'A': x**5 + x**3 - 2*x, 'B': 5*x**5 + 3*x**3 - 2*x, 'C': x**5 + x**3, 'D': 20*x**3 + 6*x}
    return (match_antideriv(f, opts), 'antiderivative check: only A differentiates back to the integrand', '')

def _int_02():
    f = exp(x) + 1/x
    opts = {'A': exp(x) + log(x), 'B': exp(x) + 1/x**2, 'C': exp(x) + log(Abs(x)), 'D': exp(x) + x}
    tk = match_antideriv(f, opts, domain_positive=True)
    return (tk, 'on x > 0 both ln(x) and ln|x| differentiate to 1/x',
            'options A and C are the SAME antiderivative on the stated domain x > 0 — defective option list')

def _int_03():
    f = sin(x) + 2*cos(x)
    opts = {'A': cos(x) + 2*sin(x), 'B': -cos(x) + 2*sin(x), 'C': sin(x) + 2*cos(x), 'D': -sin(x) - 2*cos(x)}
    return (match_antideriv(f, opts), 'antiderivative check: only B differentiates back to the integrand', '')

def _int_04():
    f = x**(-2) + x**Rational(1, 3)
    opts = {'A': -x**(-1) + Rational(3, 4)*x**Rational(4, 3),
            'B': -x**(-1) + Rational(4, 3)*x**Rational(4, 3),
            'C': -2*x**(-3) + Rational(1, 3)*x**Rational(2, 3),
            'D': x**(-1) - x**Rational(4, 3)}
    tk = match_antideriv(f, opts)
    return (tk, 'int x^(1/3) dx = (3/4)x^(4/3): d/dx of A returns the integrand; keyed B gives x^(-2) + (16/9)x^(1/3)',
            'true antiderivative is option A ((3/4) coefficient); keyed B ((4/3) coefficient) is wrong — power rule divides by n+1 = 4/3')

def _int_05():
    C0 = Symbol('C0')
    F = integrate(6*x**2 - 4*x + 1, x) + C0
    c = solve(F.subs(x, 0) - 3, C0)[0]
    v = F.subs({x: 1, C0: c})
    return (match_value(v, {'A': 2, 'B': 4, 'C': 5, 'D': 6}),
            f'F(x) = 2x^3 - 2x^2 + x + 3; F(1) = {v}',
            'true value is 4 (option B); keyed C (5) is wrong')

def _ibp_01():
    f = x*sin(x)
    opts = {'A': -x*cos(x) + sin(x), 'B': x*cos(x) - sin(x), 'C': -x*cos(x) - sin(x), 'D': x*sin(x) - cos(x)}
    return (match_antideriv(f, opts), 'antiderivative check: only A differentiates back to x sin(x)', '')

def _ibp_02():
    f = log(x)
    opts = {'A': log(x)/x, 'B': x*log(x) - x, 'C': log(x) - x, 'D': x*log(x)}
    return (match_antideriv(f, opts, domain_positive=True), 'antiderivative check: only B differentiates back to ln(x)', '')

def _ibp_03():
    f = x**2*exp(x)
    opts = {'A': exp(x)*(x**2 - 2*x + 2), 'B': x**2*exp(x), 'C': exp(x)*(x**2 - 1), 'D': 2*x*exp(x)}
    return (match_antideriv(f, opts), 'antiderivative check: only A differentiates back to x^2 e^x', '')

def _ibp_04():
    f = x*cos(x)
    opts = {'A': x*sin(x) - cos(x), 'B': x*sin(x) + cos(x), 'C': x*cos(x) + sin(x), 'D': sin(x) - x*cos(x)}
    tk = match_antideriv(f, opts)
    return (tk, 'd/dx[x sin(x) + cos(x)] = x cos(x); d/dx of keyed A = x cos(x) + 2 sin(x)',
            'true antiderivative is option B (+cos); keyed A (-cos) is wrong — the standard result is x sin(x) + cos(x) + C')

def _ibp_05():
    f = exp(x)*cos(x)
    opts = {'A': exp(x)*(sin(x) + cos(x))/2, 'B': exp(x)*sin(x),
            'C': exp(x)*(cos(x) - sin(x))/2, 'D': exp(x)*(cos(x) + sin(x))}
    return (match_antideriv(f, opts), 'antiderivative check: only A differentiates back to e^x cos(x)', '')

def _sub_01():
    f = 3*x**2*exp(x**3)
    opts = {'A': exp(x**3), 'B': x**3*exp(x**3), 'C': 3*exp(x**3), 'D': x*exp(x**3)}
    return (match_antideriv(f, opts), 'antiderivative check: only A differentiates back to the integrand', '')

def _sub_02():
    xr = Symbol('x', real=True)  # x^2+1 > 0 is provable only with a real symbol
    f = 2*xr/(xr**2 + 1)
    opts = {'A': log(xr**2 + 1), 'B': xr**2/(xr**2 + 1), 'C': log(Abs(xr**2 + 1)), 'D': 2*log(xr**2 + 1)}
    tk = [kk for kk, cand in opts.items() if simplify(diff(cand, xr) - f) == 0]
    return (tk, 'x^2 + 1 > 0 for all real x, so ln(x^2+1) and ln|x^2+1| are the SAME function',
            'options A and C are identical antiderivatives — defective option list')

def _sub_03():
    f = sin(3*x)
    opts = {'A': -cos(3*x), 'B': -cos(3*x)/3, 'C': 3*cos(3*x), 'D': -3*cos(3*x)}
    return (match_antideriv(f, opts), 'antiderivative check: only B differentiates back to sin(3x)', '')

def _sub_04():
    f = 1/(2*x + 1)**2
    opts = {'A': -1/(2*x + 1), 'B': -1/(2*(2*x + 1)), 'C': 1/(2*(2*x + 1)), 'D': -2/(2*x + 1)}
    return (match_antideriv(f, opts), 'antiderivative check: only B differentiates back to (2x+1)^(-2)', '')

def _sub_05():
    f = x*sqrt(x**2 + 1)
    opts = {'A': (x**2 + 1)**Rational(3, 2)/3, 'B': 2*(x**2 + 1)**Rational(3, 2)/3,
            'C': sqrt(x**2 + 1), 'D': sqrt(x**2 + 1)/2}
    return (match_antideriv(f, opts), 'antiderivative check: only A differentiates back to the integrand', '')

def _lim_01():
    v = limit(sin(x)/x, x, 0)
    return (match_value(v, {'A': 0, 'B': 1, 'C': pi}), f'limit = {v}', '')

def _lim_02():
    v = limit((3*x**2 + 2*x)/(x**2 + 5), x, oo)
    return (match_value(v, {'A': 0, 'B': 3, 'C': 2}), f'limit = {v}', '')

def _lim_03():
    v = limit((x**3 - 8)/(x - 2), x, 2)
    return (match_value(v, {'A': 0, 'B': 6, 'C': 12}), f'limit = {v}', '')

def _lim_04():
    v = limit((sqrt(1 + x) - 1)/x, x, 0)
    return (match_value(v, {'A': 0, 'B': Rational(1, 2), 'C': 1}), f'limit = {v}', '')

def _lim_05():
    v = limit(x*sin(1/x), x, oo)
    return (match_value(v, {'A': 0, 'B': 1}), f'limit = {v}', '')

def _max_01():
    crits = set(solve(diff(x**3 - 3*x**2 + 2, x), x))
    opts = {'A': {0, 2}, 'B': {0, 1}, 'C': {1, 2}, 'D': {-1, 2}}
    return ([kk for kk, s in opts.items() if s == crits], f'critical points {sorted(crits)}', '')

def _max_02():
    f = x**4 - 2*x**2 + 1
    d1 = diff(f, x).subs(x, 1); d2 = diff(f, x, 2).subs(x, 1)
    ok = d1 == 0 and d2 > 0
    return (['B'] if ok else [], f"f'(1) = {d1}, f''(1) = {d2} > 0 — local minimum", '')

def _max_03():
    f = x**3
    d1 = diff(f, x)
    left, right = d1.subs(x, -Rational(1, 10)), d1.subs(x, Rational(1, 10))
    no_ext = d1.subs(x, 0) == 0 and left > 0 and right > 0  # no sign change -> not an extremum
    return (['C'] if no_ext else [], f"f'(0) = 0 but f' > 0 on both sides ({left}, {right}) — no extremum; inflection at 0", '')

def _max_04():
    f = x + 1/x
    crits = [c for c in solve(diff(f, x), x) if c.is_positive]
    v = f.subs(x, crits[0]); d2 = diff(f, x, 2).subs(x, crits[0])
    ok = crits == [1] and v == 2 and d2 > 0
    return (['A'] if ok else [], f'minimum at x = {crits[0]}, value {v} (f\'\' = {d2} > 0)', '')

def _max_05():
    hh = Symbol('h', positive=True)
    xx = Symbol('x', positive=True)
    hsol = solve(xx**2 + 4*xx*hh - 100, hh)[0]
    V = xx**2*hsol
    crits = [c for c in solve(diff(V, xx), xx) if c.is_positive]
    xstar = crits[0]
    opts = {'A': 5, 'B': 10, 'C': sqrt(50), 'D': 4}
    tk = match_value(xstar, opts)
    return (tk, f'V(x) = x(100 - x^2)/4; V\' = 0 at x = {xstar} = 10/sqrt(3) ~ {float(xstar):.4f}',
            'true maximiser 10/sqrt(3) is NOT among the options; keyed A (5) is wrong')

def _mvt_01():
    crits = set(solve(diff(x**3 - 3*x, x), x))
    in_interval = {c for c in crits if -sqrt(3) < c < sqrt(3)}
    ok = in_interval == {-1, 1} and diff(x**3 - 3*x, x).subs(x, 0) != 0
    return (['B'] if ok else [], f"f'(c) = 0 at c = {sorted(in_interval)}; f'(0) = -3 != 0 so option C is wrong", '')

def _mvt_02():
    c = Symbol('c', positive=True)
    sol = solve(1/c - (log(E) - log(1))/(E - 1), c)
    tk = []
    if sol == [E - 1]:
        tk = ['B', 'D']  # both options print e-1
    return (tk, f'1/c = 1/(e-1) -> c = {sol[0]}',
            'options B and D are the SAME value e-1 (identical up to spacing) — defective option list')

def _mul_01():
    v = integrate(x + y, (x, 0, 2), (y, 0, 1))
    return (match_value(v, {'A': 1, 'B': 2, 'C': 3, 'D': 4}), f'integral = {v}', '')

def _mul_02():
    v = integrate(x, (x, 0, y), (y, 0, 1))
    return (match_value(v, {'A': Rational(1, 2), 'B': Rational(1, 3), 'C': Rational(1, 4), 'D': Rational(1, 6)}),
            f'integral = {v}', '')

def _mul_03():
    v = integrate(x + y, (x, 0, 3), (y, 0, 2))
    return (match_value(v, {'A': 6, 'B': 12, 'C': 15, 'D': 20}), f'volume = {v}', '')

def _mul_04():
    v = integrate(x*y, (y, 0, x), (x, 0, 1))
    tk = match_value(v, {'A': Rational(1, 12), 'B': Rational(1, 6), 'C': Rational(1, 4), 'D': Rational(1, 2)})
    return (tk, f'int_0^1 int_0^x xy dy dx = int_0^1 x^3/2 dx = {v}',
            'true value 1/8 is NOT among the options; keyed A (1/12) is wrong')

def _mul_05():
    r, th = symbols('r theta', positive=True)
    v = integrate(r**2*r, (r, 0, 1), (th, 0, 2*pi))
    return (match_value(v, {'A': pi/2, 'B': pi, 'C': pi/4, 'D': 2*pi}), f'polar integral = {v}', '')

def _mv_01():
    d = diff(x**3 + 2*x*y**2 - y**3, x)
    return (match_expr(d, {'A': 3*x**2 + 2*y**2, 'B': 3*x**2 + 4*x*y - 3*y**2, 'C': 4*x*y, 'D': 2*x + 4*y}),
            f'df/dx = {d}', '')

def _mv_02():
    d = diff(exp(x*y), y)
    return (match_expr(d, {'A': exp(x*y), 'B': x*exp(x*y), 'C': y*exp(x*y), 'D': exp(x)}), f'df/dy = {d}', '')

def _mv_03():
    f = x**2 + 3*x*y + y**2
    crits = solve([diff(f, x), diff(f, y)], [x, y], dict=True)
    ok = crits == [{x: 0, y: 0}]
    return (['A'] if ok else [], f'grad f = 0 only at {crits}', '')

def _mv_04():
    d = diff(diff(x**2*y**3, x), y)
    return (match_expr(d, {'A': 2*x*y**3, 'B': 6*x*y**2, 'C': 2*x*y**2, 'D': 6*x**2*y}), f'mixed partial = {d}', '')

def _mv_05():
    z = (t**2)**2 + sin(t)**2  # f(x,y)=x^2+y^2 with x=t^2, y=sin t
    d = diff(z, t)
    opts = {'A': 4*t**3 + 2*sin(t)*cos(t), 'C': 4*t**2 + 2*sin(t), 'D': 4*t + cos(t)}
    tk = [kk for kk, cand in opts.items() if simplify(cand - d) == 0]
    return (tk, f'dz/dt = {d}', 'option B (2t + 2y) is not a function of t alone — not a candidate value')

def _pf_01():
    target = apart(7/((x - 1)*(x + 2)), x)
    opts = {'A': Rational(7, 3)/(x - 1) + Rational(7, 3)/(x + 2),
            'B': Rational(7, 3)/(x - 1) - Rational(7, 3)/(x + 2),
            'C': 1/(x - 1) + 1/(x + 2),
            'D': -Rational(7, 3)/(x - 1) + Rational(7, 3)/(x + 2)}
    return (match_expr(target, opts), f'apart = {target}', '')

def _pf_02():
    f = (3*x + 5)/(x**2 + 3*x + 2)
    xp = Symbol('x', positive=True)  # log-derivative comparison on a common domain
    opts = {'A': log(xp + 1) + 2*log(xp + 2), 'B': 2*log(xp + 1) + log(xp + 2),
            'C': log(xp**2 + 3*xp + 2), 'D': Rational(3, 2)*log(xp**2 + 3*xp + 2)}
    tk = [kk for kk, cand in opts.items() if simplify(diff(cand, xp) - f.subs(x, xp)) == 0]
    return (tk, 'apart gives 2/(x+1) + 1/(x+2) -> 2 ln|x+1| + ln|x+2|', '')

def _pf_03():
    target = apart((x + 3)/(x - 1)**2, x)
    opts = {'A': 1/(x - 1) + 4/(x - 1)**2, 'B': 2/(x - 1) + 1/(x - 1)**2,
            'C': 1/(x - 1) + 3/(x - 1)**2, 'D': 3/(x - 1)**2}
    return (match_expr(target, opts), f'apart = {target}', '')

def _pf_04():
    f = 1/(x*(x + 1))
    xp = Symbol('x', positive=True)
    opts = {'A': log(xp) - log(xp + 1), 'B': log(xp) + log(xp + 1),
            'C': log(xp/(xp + 1)), 'D': log((xp + 1)/xp)}
    tk = [kk for kk, cand in opts.items() if simplify(diff(cand, xp) - f.subs(x, xp)) == 0]
    return (tk, 'ln|x| - ln|x+1| and ln|x/(x+1)| are the SAME function where defined',
            'options A and C are identical antiderivatives — defective option list')

def _pf_05():
    dec = apart((2*x + 1)/(x**2 - 1), x)
    A_ = dec.coeff(1/(x - 1), 1) if dec.has(1/(x - 1)) else Rational(3, 2)
    # robust extraction: residues at the poles
    from sympy import residue
    Ares = residue((2*x + 1)/(x**2 - 1), x, 1)
    Bres = residue((2*x + 1)/(x**2 - 1), x, -1)
    s = Ares + Bres
    return (match_value(s, {'A': 0, 'B': 1, 'C': 2, 'D': 3}),
            f'A = {Ares}, B = {Bres}; A + B = {s}', '')

def _pqr_01():
    d = diff(x*log(x), x)
    return (match_expr(d, {'A': log(x), 'B': log(x) + 1, 'C': log(x) + x, 'D': 1 + 1/x}), f"f' = {d}", '')

def _pqr_02():
    d = simplify(diff(x/(x**2 + 1), x))
    opts = {'A': 1/(x**2 + 1), 'B': (1 - x**2)/(x**2 + 1)**2, 'C': (x**2 - 1)/(x**2 + 1)**2, 'D': 2*x/(x**2 + 1)}
    return (match_expr(d, opts), f"f' = {d}", '')

def _pqr_03():
    v = diff((x**2 + 1)*exp(x), x).subs(x, 0)
    return (match_value(v, {'A': 0, 'B': 1, 'C': 2, 'D': E}), f"f'(0) = {v}", '')

def _pqr_04():
    d = simplify(diff(sin(x)/x, x))
    opts = {'A': cos(x)/x, 'B': (x*cos(x) - sin(x))/x**2, 'C': (cos(x) - sin(x))/x**2, 'D': cos(x) - sin(x)/x**2}
    return (match_expr(d, opts), f"f' = {d}", '')

def _pqr_05():
    v = simplify(diff(x**2*tan(x), x).subs(x, pi/4))
    opts = {'A': pi/4, 'B': pi/2 + pi**2/8, 'C': pi**2/8 + pi/2, 'D': 2*pi/4}
    tk = match_value(v, opts)
    return (tk, f"f'(pi/4) = 2(pi/4)tan(pi/4) + (pi/4)^2 sec^2(pi/4) = {v}",
            'options B and C are the SAME sum written in different order — defective option list')

def _seq_01():
    lims = {'A': limit(n**2, n, oo), 'C': limit((n + 1)/(2*n), n, oo), 'D': limit(exp(n), n, oo)}
    osc = True  # (-1)^n has no limit
    tk = [kk for kk, L in lims.items() if L.is_finite]
    return (tk if osc else [], f'limits: A {lims["A"]}, B none ((-1)^n oscillates), C {lims["C"]}, D {lims["D"]}', '')

def _seq_02():
    v = limit((3*n**2 + 2*n)/(n**2 + 5), n, oo)
    return (match_value(v, {'A': 0, 'B': 3, 'C': 2}), f'limit = {v}', '')

def _seq_03():
    L = limit((1 + 1/x)**x, x, oo)
    g1 = diff(x*log(1 + 1/x), x)          # g'(x) = ln(1+1/x) - 1/(x+1)
    g1_at_1 = g1.subs(x, 1)
    g1_at_inf = limit(g1, x, oo)
    g2 = simplify(diff(g1, x))            # g''(x) = -1/(x(x+1)^2) < 0 for x > 0
    xp = Symbol('x', positive=True)
    g2_neg = simplify(g2.subs(x, xp)) < 0 if g2.subs(x, xp).is_negative is not None else factor(g2) is not None
    mono = (g1_at_1 > 0) and g1_at_inf == 0 and simplify(g2.subs(x, xp)).is_negative
    ok = (L == E) and bool(mono)
    return (['B'] if ok else [],
            f"limit = {L}; g'(1) = {g1_at_1} > 0, g' -> 0, g'' = {g2} < 0 for x>0 so g' > 0 throughout — monotone increasing",
            'limit e rules out A and D; monotonicity rules out C (oscillating)')

def _seq_04():
    v = limit(sin(n)/n, n, oo)
    return (['B'] if v == 0 else [], f'limit = {v} (squeeze: |sin(n)/n| <= 1/n)', '')

def _seq_05():
    L_ = Symbol('L', positive=True)
    fixed = solve(L_**2 - (2 + L_), L_)
    a1 = 2; a2 = sqrt(2 + a1)
    tk = ['A', 'D'] if fixed == [2] and a2 == 2 else []
    return (tk, f'a1 = 2, a2 = sqrt(4) = {a2} — the sequence is constant at 2; positive fixed point {fixed}',
            'options A and D are BOTH the value 2 — duplicate options, defective option list')

def _ser_01():
    v = Sum(1/2**k, (k, 1, oo)).doit()
    return (match_value(v, {'A': 1, 'B': 2, 'C': Rational(1, 2)}), f'sum = {v}', '')

def _ser_02():
    conv = {'A': Sum(1/k, (k, 1, oo)).is_convergent(),
            'B': Sum(k**Rational(-1, 2), (k, 1, oo)).is_convergent(),
            'C': Sum(1/k**2, (k, 1, oo)).is_convergent(),
            'D': Sum(k**Rational(-4, 5), (k, 1, oo)).is_convergent()}
    tk = [kk for kk, c in conv.items() if c]
    return (tk, f'convergence: {conv} — only the p=2 series converges', '')

def _ser_03():
    L = limit(((3*n + 1)/(n**3 + 2*n))/(1/n**2), n, oo)
    conv = Sum((3*k + 1)/(k**3 + 2*k), (k, 1, oo)).is_convergent()
    ok = L == 3 and L.is_finite and L > 0 and conv
    return (['B'] if ok else [], f'limit-comparison ratio = {L} (finite, positive); series convergent = {conv}', '')

def _ser_04():
    r = limit(factorial(n + 1)/(n + 1)**(n + 1) * n**n/factorial(n), n, oo)
    conv = Sum(factorial(k)/k**k, (k, 1, oo)).is_convergent()
    ok = simplify(r - 1/E) == 0 and r < 1 and conv
    return (['A'] if ok else [], f'ratio-test limit = {r} = 1/e < 1; series convergent = {conv}', '')

def _ser_05():
    conv = Sum((-1)**k/k, (k, 1, oo)).is_convergent()
    abs_conv = Sum(1/k, (k, 1, oo)).is_convergent()
    ok = conv and not abs_conv
    return (['B'] if ok else [], f'alternating series convergent = {conv}; absolute series (harmonic) convergent = {abs_conv} — conditionally convergent', '')


# ---------------------------------------------------------------------------
# Conceptual items — theorem-statement MCQs with no decisive CAS check.
# Twin single-LLM solve recorded as ADVISORY evidence only.
# ---------------------------------------------------------------------------
CONCEPTUAL = {
    'diff-05': ('B', 'differentiability at a point implies continuity there (standard theorem)'),
    'mvt-03': ('B', 'Rolle requires differentiability on (a,b); |x| is not differentiable at 0. '
                    'Option A states true endpoint values but the wrong conclusion; C is false for the same reason'),
    'mvt-04': ('A', "f' = 0 on an interval => f constant is the classic MVT corollary; B reverses the "
                    'monotonicity conclusion; C and D are unrelated/false as consequences of MVT'),
    'mvt-05': ('A', 'average speed 50 mph; MVT gives an instant where instantaneous speed EQUALS the average'),
}

CAS_CHECKS = {
    'ca-001': _ca_001, 'ca-002': _ca_002, 'ca-003': _ca_003, 'ca-004': _ca_004,
    'ca-005': _ca_005, 'ca-006': _ca_006, 'ca-007': _ca_007, 'ca-008': _ca_008,
    'ca-009': _ca_009, 'ca-010': _ca_010, 'ca-011': _ca_011, 'ca-012': _ca_012,
    'ca-013': _ca_013, 'ca-014': _ca_014, 'ca-015': _ca_015,
    'chr-01': _chr_01, 'chr-02': _chr_02, 'chr-03': _chr_03, 'chr-04': _chr_04, 'chr-05': _chr_05,
    'con-01': _con_01, 'con-02': _con_02, 'con-03': _con_03, 'con-04': _con_04, 'con-05': _con_05,
    'def-01': _def_01, 'def-02': _def_02, 'def-03': _def_03, 'def-04': _def_04, 'def-05': _def_05,
    'der-01': _der_01, 'der-02': _der_02, 'der-03': _der_03, 'der-04': _der_04, 'der-05': _der_05,
    'diff-01': _diff_01, 'diff-02': _diff_02, 'diff-03': _diff_03, 'diff-04': _diff_04,
    'id-01': _id_01, 'id-02': _id_02, 'id-03': _id_03, 'id-04': _id_04, 'id-05': _id_05,
    'imp-01': _imp_01, 'imp-02': _imp_02, 'imp-03': _imp_03, 'imp-04': _imp_04, 'imp-05': _imp_05,
    'int-01': _int_01, 'int-02': _int_02, 'int-03': _int_03, 'int-04': _int_04, 'int-05': _int_05,
    'ibp-01': _ibp_01, 'ibp-02': _ibp_02, 'ibp-03': _ibp_03, 'ibp-04': _ibp_04, 'ibp-05': _ibp_05,
    'sub-01': _sub_01, 'sub-02': _sub_02, 'sub-03': _sub_03, 'sub-04': _sub_04, 'sub-05': _sub_05,
    'lim-01': _lim_01, 'lim-02': _lim_02, 'lim-03': _lim_03, 'lim-04': _lim_04, 'lim-05': _lim_05,
    'max-01': _max_01, 'max-02': _max_02, 'max-03': _max_03, 'max-04': _max_04, 'max-05': _max_05,
    'mvt-01': _mvt_01, 'mvt-02': _mvt_02,
    'mul-01': _mul_01, 'mul-02': _mul_02, 'mul-03': _mul_03, 'mul-04': _mul_04, 'mul-05': _mul_05,
    'mv-01': _mv_01, 'mv-02': _mv_02, 'mv-03': _mv_03, 'mv-04': _mv_04, 'mv-05': _mv_05,
    'pf-01': _pf_01, 'pf-02': _pf_02, 'pf-03': _pf_03, 'pf-04': _pf_04, 'pf-05': _pf_05,
    'pqr-01': _pqr_01, 'pqr-02': _pqr_02, 'pqr-03': _pqr_03, 'pqr-04': _pqr_04, 'pqr-05': _pqr_05,
    'seq-01': _seq_01, 'seq-02': _seq_02, 'seq-03': _seq_03, 'seq-04': _seq_04, 'seq-05': _seq_05,
    'ser-01': _ser_01, 'ser-02': _ser_02, 'ser-03': _ser_03, 'ser-04': _ser_04, 'ser-05': _ser_05,
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
                            'computed': 'no decisive CAS check for a theorem/definitional MCQ',
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
        'scope': 'GATE-EM Calculus (28-mark common block, slice 1): topic bank (15) + 19 concept banks (95)',
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
    run_path = os.path.join(OUT_DIR, 'runs', '2026-09-03-run-002-calculus.json')
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
