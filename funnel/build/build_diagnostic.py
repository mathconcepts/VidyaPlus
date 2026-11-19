#!/usr/bin/env python3
"""
Build the GATE EC Engineering Maths diagnostic (funnel v0) from the bank.

Every item gets an AUTHORED SymPy check that recomputes the answer from the
question's own data and evaluates EVERY option. An item ships only if exactly
one option is true and it is the keyed one. The check never reads the stored
key to decide truth; it compares against it at the end.

Guards: each check states the option text it was written against. If the live
bank text differs, the build fails, so a silent edit can't keep an old receipt.

Human review (decision D1, 19 Nov): the receipt says "SymPy check · reviewed by
Giri" only for items Giri has marked reviewed in funnel/review/giri-review.json.
`--release` fails unless all 20 are reviewed and at least 5 are hand-solved.
Without --release the build writes a PREVIEW pack whose chip says
"SymPy check · review pending" and the page shows a preview banner.

Usage:
  python3 funnel/build/build_diagnostic.py            # preview
  python3 funnel/build/build_diagnostic.py --release  # production pack
Writes funnel/site/data/diagnostic.json
"""
import json, os, re, sys, datetime, hashlib
import sympy as sp
from sympy import (Matrix, Rational, symbols, sin, cos, exp, E, pi, I, integrate,
                   limit, diff, simplify, residue, Function, Eq, dsolve, roots,
                   Poly, oo, sqrt)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TOPICS = os.path.join(ROOT, 'data', 'courses', 'gate-em', 'topics')
OUT = os.path.join(ROOT, 'funnel', 'site', 'data', 'diagnostic.json')
REVIEW = os.path.join(ROOT, 'funnel', 'review', 'giri-review.json')

x, y, z, t = symbols('x y z t')
yf = Function('y')

# Topic labels as students know them (GATE EC syllabus wording).
TOPIC_LABEL = {
    '01-linear-algebra': 'Linear Algebra',
    '02-calculus': 'Calculus',
    '03-differential-equations': 'Differential Equations',
    '04-complex-variables': 'Complex Analysis',
    '05-probability-statistics': 'Probability & Statistics',
    '10-vector-calculus': 'Vector Calculus',
}

# Presentation-only fixes (no change to maths). Reviewed by Giri with the item.
DISPLAY_FIX = {
    # vector-calculus bank writes squares as "x2"; render as x².
    'vc-001': [(r'\b([xyz])2\b', r'\1²')],
    'vc-014': [(r'\b([xyz])2\b', r'\1²'), (r'(\d)pi\b', r'\1π'), (r'\bpi\b', 'π')],
}


def same(a, b):
    return simplify(a - b) == 0


def judge(opts_values, truth, eq=same):
    """Map each option to True/False against the computed truth."""
    return {k: bool(eq(v, truth)) for k, v in opts_values.items()}


# ---------------------------------------------------------------- checks
# Each returns (expected_option_text, option_truth, working) where `working`
# is a one-line description of what SymPy computed (shown on the receipt).

def c_la001():
    ev = Matrix([[3, 1], [1, 3]]).eigenvals()
    truth = sorted(ev.keys())
    opts = {'A': [2, 4], 'B': [3, 3], 'C': [0, 6], 'D': [1, 4]}
    tv = {k: sorted(v) == truth for k, v in opts.items()}
    return ({'A': '4 and 2', 'B': '3 and 3', 'C': '6 and 0', 'D': '4 and 1'}, tv,
            f'eigenvals([[3,1],[1,3]]) = {truth}')

def c_la004():
    lam = Matrix.diag(1, 2, 3)            # any A with eigenvalues 1,2,3 (det is similarity-invariant)
    truth = (2 * lam.inv()).det()
    opts = {'A': Rational(1, 3), 'B': Rational(8, 3), 'C': Rational(4, 3), 'D': 1}
    return ({'A': '1/3', 'B': '8/3', 'C': '4/3', 'D': '1'}, judge(opts, truth),
            f'det(2·A⁻¹) with eig(A) = 1,2,3 → {truth}')

def c_la006():
    truth = Matrix([[1, 2, 3], [4, 5, 6], [7, 8, 9]]).det()
    opts = {'A': 0, 'B': 6, 'C': -6, 'D': 45}
    return ({'A': '0', 'B': '6', 'C': '-6', 'D': '45'}, judge(opts, truth), f'det = {truth}')

def c_la011():
    truth = (Matrix.diag(2, 3, 5) ** 2).trace()
    opts = {'A': 10, 'B': 38, 'C': 100, 'D': 30}
    return ({'A': '10', 'B': '38', 'C': '100', 'D': '30'}, judge(opts, truth),
            f'trace(A²) = 2²+3²+5² = {truth}')

def c_ca001():
    truth = limit(sin(3 * x) / (5 * x), x, 0)
    opts = {'A': Rational(3, 5), 'B': Rational(5, 3), 'C': 1, 'D': 0}
    return ({'A': '3/5', 'B': '5/3', 'C': '1', 'D': '0'}, judge(opts, truth), f'limit = {truth}')

def c_ca003():
    truth = integrate(x * exp(x), (x, 0, 1))
    opts = {'A': 1, 'B': E - 1, 'C': E, 'D': 2}
    return ({'A': '1', 'B': 'e - 1', 'C': 'e', 'D': '2'}, judge(opts, truth), f'∫₀¹ x·eˣ dx = {truth}')

def c_ca006():
    truth = limit((exp(x) - 1 - x) / x**2, x, 0)
    opts = {'A': 0, 'B': 1, 'C': Rational(1, 2), 'D': 2}
    return ({'A': '0', 'B': '1', 'C': '1/2', 'D': '2'}, judge(opts, truth), f'limit = {truth}')

def c_ca015():
    pts = sp.solve(Eq(x**2, x), x)
    truth = integrate(x - x**2, (x, min(pts), max(pts)))
    opts = {'A': Rational(1, 6), 'B': Rational(1, 3), 'C': Rational(1, 2), 'D': 1}
    return ({'A': '1/6', 'B': '1/3', 'C': '1/2', 'D': '1'}, judge(opts, truth),
            f'curves meet at x = {pts}; area = {truth}')

def c_de002():
    r = symbols('r')
    rts = roots(Poly(r**2 - 6 * r + 9, r))
    opts = {'A': {3: 1, -3: 1}, 'B': {3: 2}, 'C': {6: 1, 1: 1}, 'D': {3 + 3 * I: 1, 3 - 3 * I: 1}}
    tv = {k: v == rts for k, v in opts.items()}
    return ({'A': '3 and -3', 'B': '3 and 3 (repeated)', 'C': '6 and 1', 'D': '3 ± 3i'}, tv,
            f'roots of r²−6r+9 = {rts}')

def c_de009():
    Y = yf(x)
    sol = dsolve(Eq(Y.diff(x, 2) - 5 * Y.diff(x) + 6 * Y, 0), Y,
                 ics={yf(0): 1, Y.diff(x).subs(x, 0): 0}).rhs
    opts = {'A': 3 * exp(2 * x) - 2 * exp(3 * x), 'B': 2 * exp(2 * x) - exp(3 * x),
            'C': exp(2 * x) + exp(3 * x), 'D': 3 * exp(3 * x) - 2 * exp(2 * x)}
    return ({'A': 'y = 3e^(2x) - 2e^(3x)', 'B': 'y = 2e^(2x) - e^(3x)',
             'C': 'y = e^(2x) + e^(3x)', 'D': 'y = 3e^(3x) - 2e^(2x)'},
            judge(opts, sol), f'dsolve with y(0)=1, y′(0)=0 → {sol}')

def c_de014():
    Y = yf(x)
    c1, c2 = symbols('c1 c2')
    ode = Y.diff(x, 2) + 2 * Y.diff(x) + 5 * Y
    opts = {'A': exp(-x) * (c1 * cos(2 * x) + c2 * sin(2 * x)),
            'B': exp(x) * (c1 * cos(2 * x) + c2 * sin(2 * x)),
            'C': (c1 + c2 * x) * exp(-x),
            'D': c1 * exp(-x) + c2 * exp(x)}
    tv = {k: simplify(ode.subs(Y, v).doit()) == 0 for k, v in opts.items()}
    return ({'A': 'y = e^(-x)(c₁cos 2x + c₂sin 2x)', 'B': 'y = e^x(c₁cos 2x + c₂sin 2x)',
             'C': 'y = (c₁ + c₂x)e^(-x)', 'D': 'y = c₁e^(-x) + c₂e^(x)'}, tv,
            'each option substituted into y″+2y′+5y; only A gives 0 for all c₁, c₂')

def c_cv003():
    truth = residue(exp(z) / (z - 1)**2, z, 1)
    opts = {'A': E, 'B': E / 2, 'C': 1, 'D': 2 * E}
    return ({'A': 'e', 'B': 'e/2', 'C': '1', 'D': '2e'}, judge(opts, truth), f'Res = {truth}')

def c_cv007():
    truth = sp.expand((1 + I)**8)
    opts = {'A': 16, 'B': 8, 'C': -16, 'D': 16 * I}
    return ({'A': '16', 'B': '8', 'C': '-16', 'D': '16i'}, judge(opts, truth), f'(1+i)⁸ = {truth}')

def c_cv009():
    truth = 2 * pi * I * residue(z**2 / (z - 2), z, 2)   # z = 2 lies inside |z| = 3
    opts = {'A': 0, 'B': 8 * pi * I, 'C': 4 * pi * I, 'D': 16 * pi * I}
    return ({'A': '0', 'B': '8πi', 'C': '4πi', 'D': '16πi'}, judge(opts, truth),
            f'2πi·Res(z=2) = {truth}')

def c_ps001():
    fav = sum(1 for a in range(1, 7) for b in range(1, 7) if a + b > 9)
    truth = Rational(fav, 36)
    opts = {'A': Rational(1, 6), 'B': Rational(1, 4), 'C': Rational(1, 12), 'D': Rational(5, 12)}
    return ({'A': '1/6', 'B': '1/4', 'C': '1/12', 'D': '5/12'}, judge(opts, truth),
            f'{fav}/36 = {truth}')

def c_ps004():
    truth = 2**2 * 2 + (-1)**2 * 3
    opts = {'A': 11, 'B': 8, 'C': 14, 'D': 6}
    return ({'A': '11', 'B': '8', 'C': '14', 'D': '6'}, judge(opts, truth),
            f'4·Var(X) + Var(Y) = {truth}')

def c_ps005():
    from sympy.stats import Exponential, P
    X = Exponential('X', Rational(1, 2))
    truth = simplify(P(X > 3))
    opts = {'A': exp(Rational(-3, 2)), 'B': exp(Rational(-2, 3)), 'C': 1 - exp(Rational(-3, 2)), 'D': exp(-6)}
    return ({'A': 'e^(-3/2)', 'B': 'e^(-2/3)', 'C': '1 - e^(-3/2)', 'D': 'e^(-6)'},
            judge(opts, truth), f'P(X>3), rate 1/2 → {truth}')

def c_ps015():
    truth = Rational(4, 52) * Rational(3, 51)
    opts = {'A': Rational(1, 221), 'B': Rational(1, 169), 'C': Rational(4, 52), 'D': Rational(1, 52)}
    return ({'A': '1/221', 'B': '1/169', 'C': '4/52', 'D': '1/52'}, judge(opts, truth),
            f'(4/52)(3/51) = {truth}')

def c_vc001():
    X, Y, Z = symbols('X Y Z')
    div = diff(X**2, X) + diff(Y**2, Y) + diff(Z**2, Z)
    truth = div.subs({X: 1, Y: 2, Z: 3})
    opts = {'A': 12, 'B': 6, 'C': 14, 'D': 2}
    return ({'A': '12', 'B': '6', 'C': '14', 'D': '2'}, judge(opts, truth), f'div F at (1,2,3) = {truth}')

def c_vc014():
    # Direct surface integral (not the theorem) as the independent check.
    th, ph = symbols('theta phi')
    rvec = Matrix([sin(ph) * cos(th), sin(ph) * sin(th), cos(ph)])
    n_dA = rvec.diff(ph).cross(rvec.diff(th))          # outward for this ordering
    integrand = simplify(rvec.dot(n_dA))
    truth = integrate(integrand, (ph, 0, pi), (th, 0, 2 * pi))
    opts = {'A': 4 * pi, 'B': 2 * pi, 'C': pi, 'D': 3 * pi}
    return ({'A': '4pi', 'B': '2pi', 'C': 'pi', 'D': '3pi'}, judge(opts, truth),
            f'surface integral of F·n over the unit sphere = {truth}')

CHECKS = {
    'la-001': c_la001, 'la-004': c_la004, 'la-006': c_la006, 'la-011': c_la011,
    'ca-001': c_ca001, 'ca-003': c_ca003, 'ca-006': c_ca006, 'ca-015': c_ca015,
    'de-002': c_de002, 'de-009': c_de009, 'de-014': c_de014,
    'cv-003': c_cv003, 'cv-007': c_cv007, 'cv-009': c_cv009,
    'ps-001': c_ps001, 'ps-004': c_ps004, 'ps-005': c_ps005, 'ps-015': c_ps015,
    'vc-001': c_vc001, 'vc-014': c_vc014,
}


def load_bank():
    items = {}
    for folder in TOPIC_LABEL:
        path = os.path.join(TOPICS, folder, 'mcqs.json')
        for q in json.load(open(path, encoding='utf-8'))['questions']:
            items[q['id']] = (folder, os.path.relpath(path, ROOT) if path.startswith(ROOT) else path, q)
    return items


def display(iid, text):
    for pat, rep in DISPLAY_FIX.get(iid, []):
        text = re.sub(pat, rep, text)
    return text


def _flag(name, default):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return os.path.abspath(sys.argv[i + 1])
    return default


def main():
    global TOPICS, OUT
    TOPICS = _flag('--topics', TOPICS)  # tests point these at temp copies
    OUT = _flag('--out', OUT)
    release = '--release' in sys.argv
    bank = load_bank()
    review = json.load(open(REVIEW, encoding='utf-8')) if os.path.exists(REVIEW) else {'items': {}}
    reviewer = review.get('reviewer', 'Giri')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

    out_items, problems = [], []
    for iid, check in CHECKS.items():
        folder, src, q = bank[iid]
        expected, truth, working = check()
        for k, txt in expected.items():
            if q['options'][k] != txt:
                problems.append(f'{iid}: option {k} changed: {q["options"][k]!r} != {txt!r}')
        true_opts = sorted(k for k, v in truth.items() if v)
        if true_opts != [q['correct_answer']]:
            problems.append(f'{iid}: SymPy says {true_opts}, key is {q["correct_answer"]}')
            continue
        rv = review.get('items', {}).get(iid, {})
        fingerprint = hashlib.sha256(json.dumps(
            [q['question'], q['options'], q['correct_answer']], ensure_ascii=False).encode()).hexdigest()[:12]
        reviewed = bool(rv.get('reviewed')) and rv.get('fingerprint') == fingerprint
        out_items.append({
            'id': iid,
            'topic': TOPIC_LABEL[folder],
            'marks': q.get('marks', 1),
            'negative': abs(float(q.get('negative_marks', -0.33))),
            'question': display(iid, q['question']),
            'options': {k: display(iid, v) for k, v in q['options'].items()},
            'answer': q['correct_answer'],
            'solution': display(iid, q['explanation']),
            'receipt': {
                'engine': 'SymPy ' + sp.__version__,
                'working': working,
                'options_checked': len(truth),
                'unique_true': True,
                'reviewed_by': reviewer if reviewed else None,
                'reviewed_at': rv.get('reviewed_at') if reviewed else None,
                'hand_solved': bool(rv.get('hand_solved')) if reviewed else False,
                'fingerprint': fingerprint,
                'source': src,
            },
        })

    if problems:
        print('BUILD FAILED — items that must not ship:')
        for p in problems:
            print('  ' + p)
        sys.exit(1)

    n_rev = sum(1 for i in out_items if i['receipt']['reviewed_by'])
    n_hand = sum(1 for i in out_items if i['receipt']['hand_solved'])
    if release and (n_rev < len(out_items) or n_hand < 5):
        print(f'RELEASE BLOCKED: reviewed {n_rev}/{len(out_items)}, hand-solved {n_hand}/5 minimum.')
        print('Fill funnel/review/giri-review.json (fingerprints are printed by --fingerprints).')
        sys.exit(2)

    pack = {
        'pack_id': 'gate-ec-2027-em-diagnostic',
        'version': '0.1.0',
        'built_at': now,
        'mode': 'release' if release else 'preview',
        'exam': 'GATE EC 2027 · Engineering Mathematics',
        'em_section_marks': 13,
        'items': out_items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, indent=1)
    total = sum(i['marks'] for i in out_items)
    print(f'OK {len(out_items)} items · {total} marks · mode={pack["mode"]} · reviewed {n_rev} · hand-solved {n_hand}')
    if '--fingerprints' in sys.argv:
        for i in out_items:
            print(f'  {i["id"]}: {i["receipt"]["fingerprint"]}')


if __name__ == '__main__':
    main()
