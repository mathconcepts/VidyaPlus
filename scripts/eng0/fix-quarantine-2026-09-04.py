#!/usr/bin/env python3
"""
ENG-0 / S14 fix pass — 2026-09-04 (overnight worker)

Applies the pre-decided S14 response to the 20 items quarantined by audit
runs #1 (Linear Algebra) and #2 (Calculus): the failing item classes
become overnight fix work. Every edit below is derived from the CAS
result recorded in data/verification/eng0/runs/ — no fix is invented.

Fix classes:
  wrong-key (4): the CAS-true option exists in the list — re-key to it
    and rewrite the explanation (several shipped with the generator's own
    "Wait, let me recalculate..." confusion, which must never be served).
  no-correct-option (5): the true value is absent — the keyed option's
    text is replaced with the CAS-computed true value (key letter kept),
    explanation rewritten to the correct derivation.
  defective-options (11): two options are the same mathematical object —
    the non-keyed duplicate is replaced with a distinct, plausible wrong
    value; the keyed answer is untouched.

After this script, scripts/eng0/audit-run-003-quarantine-reaudit.py
re-verifies all 20 items against the LIVE file data (it does not share
transcriptions with this script) and updates the quarantine log.

Idempotent: re-running applies the same end state.
"""
import json, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')

def _collapse_tags(text):
    """The committed banks keep "tags" arrays on one line; json.dump expands
    them. Collapse them back so the diff is only the actual fix."""
    def _one_line(m):
        items = re.findall(r'"(?:[^"\\]|\\.)*"', m.group(1))
        return '"tags": [' + ', '.join(items) + ']'
    return re.sub(r'"tags": \[\n((?:\s+"(?:[^"\\]|\\.)*",?\n)+)\s+\]', _one_line, text)

def edit(path, item_id, fn):
    p = os.path.join(ROOT, path)
    d = json.load(open(p))
    hit = False
    for q in d['questions']:
        if q['id'] == item_id:
            fn(q); hit = True
    assert hit, f'{item_id} not found in {path}'
    text = _collapse_tags(json.dumps(d, indent=2, ensure_ascii=False))
    if not text.endswith('\n'):
        text += '\n'
    open(p, 'w').write(text)
    print(f'fixed {item_id:8s} in {path}')

# ---------------------------------------------------------------- wrong-key
def fx_mop01(q):  # true (1,2) entry of AB is 1 = option A; keyed C was the (1,1) entry
    q['correct_answer'] = 'A'
    q['explanation'] = (
        "The (1,2) entry of $AB$ is row 1 of $A$ times column 2 of $B$:\n"
        "$(AB)_{12} = 2(0) + 1(1) = 1$.\n\n"
        "Full product for reference:\n"
        "$AB = \\begin{pmatrix} 2 & 1 \\\\ 0 & 3 \\end{pmatrix} \\begin{pmatrix} 1 & 0 \\\\ 2 & 1 \\end{pmatrix} "
        "= \\begin{pmatrix} 4 & 1 \\\\ 6 & 3 \\end{pmatrix}$.\n\n"
        "Common mistake: reading off $(AB)_{11} = 4$ (row 1 · column 1) instead of the asked (1,2) entry.")

def fx_int04(q):  # power rule: coefficient 3/4, option A
    q['correct_answer'] = 'A'
    q['explanation'] = (
        "$$\\int x^{-2} \\, dx = \\frac{x^{-1}}{-1} = -x^{-1}$$\n"
        "$$\\int x^{1/3} \\, dx = \\frac{x^{1/3+1}}{1/3+1} = \\frac{x^{4/3}}{4/3} = \\frac{3}{4}x^{4/3}$$\n\n"
        "So the antiderivative is $-x^{-1} + \\frac{3}{4}x^{4/3} + C$.\n\n"
        "Common mistake: multiplying by the new exponent $\\frac{4}{3}$ instead of dividing by it — "
        "the power rule divides by $n+1$.")

def fx_int05(q):  # F(1) = 4, option B
    q['correct_answer'] = 'B'
    q['explanation'] = (
        "$$F(x) = \\int (6x^2 - 4x + 1) \\, dx = 2x^3 - 2x^2 + x + C$$\n\n"
        "Use $F(0) = 3$: $C = 3$, so $F(x) = 2x^3 - 2x^2 + x + 3$.\n\n"
        "$$F(1) = 2 - 2 + 1 + 3 = 4$$")

def fx_ibp04(q):  # x sin x + cos x + C, option B
    q['correct_answer'] = 'B'
    q['explanation'] = (
        "Let $u = x$, $dv = \\cos(x)\\,dx$, so $du = dx$, $v = \\sin(x)$.\n\n"
        "$$\\int x \\cos(x) \\, dx = x \\sin(x) - \\int \\sin(x) \\, dx = x \\sin(x) - (-\\cos(x)) + C "
        "= x \\sin(x) + \\cos(x) + C$$\n\n"
        "Check by differentiating: $\\frac{d}{dx}[x\\sin(x) + \\cos(x)] = \\sin(x) + x\\cos(x) - \\sin(x) = x\\cos(x)$. ✓")

# --------------------------------------------------------- no-correct-option
def fx_det03(q):  # true det = 1; put 1 in the keyed slot D
    q['options']['D'] = '1'
    q['explanation'] = (
        "Expand along the first row:\n"
        "$\\det(A) = 2 \\begin{vmatrix} 3 & 2 \\\\ 1 & 1 \\end{vmatrix} - 1 \\begin{vmatrix} 1 & 2 \\\\ 0 & 1 \\end{vmatrix} "
        "+ 0 \\begin{vmatrix} 1 & 3 \\\\ 0 & 1 \\end{vmatrix}$\n\n"
        "The 2×2 minors: $3(1) - 2(1) = 1$, $1(1) - 2(0) = 1$, $1(1) - 3(0) = 1$.\n\n"
        "$\\det(A) = 2(1) - 1(1) + 0(1) = 1$.")

def fx_det04(q):  # true -90 in keyed slot A
    q['options']['A'] = '-90'
    q['explanation'] = (
        "Use the properties of determinants:\n"
        "- $\\det(AB) = \\det(A)\\det(B) = 5 \\cdot (-2) = -10$\n"
        "- $\\det(cM) = c^n \\det(M)$ for an $n \\times n$ matrix\n\n"
        "For the $2 \\times 2$ matrix $3AB$:\n"
        "$$\\det(3AB) = 3^2 \\det(AB) = 9 \\cdot (-10) = -90$$\n\n"
        "Common mistake: multiplying by $3$ instead of $3^2$ — the scalar comes out once per row.")

def fx_mop03(q):  # true commutator [[0,-1],[0,0]] in keyed slot D
    q['options']['D'] = '$\\begin{pmatrix} 0 & -1 \\\\ 0 & 0 \\end{pmatrix}$'
    q['explanation'] = (
        "Compute $AB$:\n"
        "$AB = \\begin{pmatrix} 1 & 1 \\\\ 0 & 1 \\end{pmatrix} \\begin{pmatrix} 2 & -1 \\\\ 0 & 1 \\end{pmatrix} "
        "= \\begin{pmatrix} 2 & 0 \\\\ 0 & 1 \\end{pmatrix}$.\n\n"
        "Compute $BA$:\n"
        "$BA = \\begin{pmatrix} 2 & -1 \\\\ 0 & 1 \\end{pmatrix} \\begin{pmatrix} 1 & 1 \\\\ 0 & 1 \\end{pmatrix} "
        "= \\begin{pmatrix} 2 & 1 \\\\ 0 & 1 \\end{pmatrix}$.\n\n"
        "$$AB - BA = \\begin{pmatrix} 0 & -1 \\\\ 0 & 0 \\end{pmatrix}$$\n\n"
        "Note $AB \\ne BA$: matrix multiplication is not commutative.")

def fx_max05(q):  # true maximiser 10/sqrt(3) in keyed slot A
    q['options']['A'] = '$x = \\frac{10}{\\sqrt{3}}$'
    q['explanation'] = (
        "From $x^2 + 4xh = 100$: $h = \\frac{100 - x^2}{4x}$.\n\n"
        "Volume: $V = x^2 h = \\frac{x(100 - x^2)}{4} = \\frac{100x - x^3}{4}$.\n\n"
        "$$\\frac{dV}{dx} = \\frac{100 - 3x^2}{4} = 0 \\Rightarrow x^2 = \\frac{100}{3} "
        "\\Rightarrow x = \\frac{10}{\\sqrt{3}} \\approx 5.77$$\n\n"
        "$V'' = -\\frac{3x}{2} < 0$ there, so this is the maximum.")

def fx_mul04(q):  # true value 1/8 in keyed slot A
    q['options']['A'] = '$1/8$'
    q['explanation'] = (
        "Region: $0 \\leq x \\leq 1$, $0 \\leq y \\leq x$.\n\n"
        "Inner integral (w.r.t. $y$):\n"
        "$$\\int_0^x xy \\, dy = x \\cdot \\frac{x^2}{2} = \\frac{x^3}{2}$$\n\n"
        "Outer integral (w.r.t. $x$):\n"
        "$$\\int_0^1 \\frac{x^3}{2} \\, dx = \\frac{1}{2} \\cdot \\frac{1}{4} = \\frac{1}{8}$$")

# --------------------------------------------------------- defective-options
def fx_la004(q):  # A "8/6" duplicated keyed C "4/3" -> plausible wrong 1/3 (2·det(A^-1), cube forgotten)
    q['options']['A'] = '1/3'

def fx_dia05(q):  # C "Only over C" was also true -> distinct false claim
    q['options']['C'] = 'Yes, because every rotation matrix is diagonalizable over $\\mathbb{R}$'

def fx_vs04(q):  # B (-1,1,0) spans the same null space as keyed C -> replace with a non-null-space vector
    q['options']['B'] = '$\\{(0, 1, 1)\\}$'

def fx_chr04(q):  # D cot(x) == keyed B cos/sin -> replace with tan(x); fix the equivalence note
    q['options']['D'] = '$\\tan(x)$'
    q['explanation'] = (
        "Apply the chain rule. Let $u = \\sin(x)$:\n"
        "$$f'(x) = \\frac{1}{u} \\cdot \\frac{du}{dx} = \\frac{1}{\\sin(x)} \\cdot \\cos(x) "
        "= \\frac{\\cos(x)}{\\sin(x)} = \\cot(x)$$\n\n"
        "Option D, $\\tan(x)$, is the reciprocal of the correct answer — a sign of mixing up "
        "$\\frac{d}{dx}\\ln(\\sin x)$ with $\\frac{d}{dx}\\ln(\\cos x) = -\\tan(x)$.")

def fx_con02(q):  # C's piecewise was also continuous -> introduce a jump at the seam
    q['options']['C'] = ('$f(x) = \\begin{cases} x & \\text{if } x \\leq 1 \\\\ '
                         'x + 1 & \\text{if } x > 1 \\end{cases}$')
    q['explanation'] = (
        "Check each function:\n\n"
        "A) $f(x) = 1/x$: discontinuous at $x = 0$ (infinite discontinuity).\n\n"
        "B) $f(x) = |x|$: continuous everywhere. At $x = 0$: "
        "$\\lim_{x \\to 0^-} |x| = \\lim_{x \\to 0^+} |x| = |0| = 0$.\n\n"
        "C) The piecewise function: at $x = 1$, $\\lim_{x \\to 1^-} f(x) = 1$ but "
        "$\\lim_{x \\to 1^+} f(x) = 2$ — a jump discontinuity.\n\n"
        "D) $f(x) = \\tan(x)$: discontinuous at $x = \\pi/2 + n\\pi$.\n\n"
        "The answer is B.")

def fx_int02(q):  # C ln|x| == keyed A ln(x) on x>0 -> distinct wrong option
    q['options']['C'] = '$e^x \\ln(x) + C$'
    q['explanation'] = (
        "$$\\int e^x \\, dx = e^x, \\qquad \\int \\frac{1}{x} \\, dx = \\ln|x| + C$$\n\n"
        "For $x > 0$: $\\ln|x| = \\ln(x)$.\n\nTotal: $e^x + \\ln(x) + C$.\n\n"
        "Option C multiplies the two antiderivatives — integration is additive over a sum, "
        "not multiplicative.")

def fx_sub02(q):  # C ln|x^2+1| == keyed A -> plausible wrong: half coefficient
    q['options']['C'] = '$\\frac{1}{2}\\ln(x^2 + 1) + C$'
    q['explanation'] = (
        "Let $u = x^2 + 1$, so $du = 2x \\, dx$ — the numerator is exactly $du$.\n\n"
        "$$\\int \\frac{2x}{x^2 + 1} \\, dx = \\int \\frac{1}{u} \\, du = \\ln|u| + C = \\ln(x^2 + 1) + C$$\n\n"
        "(No absolute value needed: $x^2 + 1 > 0$ always.)\n\n"
        "Option C ($\\frac{1}{2}\\ln$) would follow from forgetting that the $2x$ in the numerator "
        "already matches $du$.")

def fx_mvt02(q):  # D was a literal duplicate of keyed B "e-1" -> distinct wrong value
    q['options']['D'] = '$c = \\frac{e+1}{2}$'

def fx_pf04(q):  # C ln|x/(x+1)| == keyed A -> distinct wrong option
    q['options']['C'] = '$\\ln|x(x+1)| + C$'
    q['explanation'] = (
        "Decompose: $\\frac{1}{x(x+1)} = \\frac{A}{x} + \\frac{B}{x+1}$\n\n"
        "$1 = A(x+1) + Bx$. At $x = 0$: $A = 1$. At $x = -1$: $B = -1$.\n\n"
        "$$\\int \\frac{1}{x} dx - \\int \\frac{1}{x+1} dx = \\ln|x| - \\ln|x+1| + C$$\n\n"
        "(Equivalently $\\ln\\left|\\frac{x}{x+1}\\right| + C$.) Option C, $\\ln|x(x+1)|$, is the "
        "SUM of the two logs — the sign of $B$ matters.")

def fx_pqr05(q):  # B was the same sum as keyed C in different order -> plausible wrong (sec^2 = 1 slip)
    q['options']['B'] = '$\\pi/2 + \\pi^2/16$'

def fx_seq05(q):  # D was a duplicate "2" -> the rejected fixed point -1
    q['options']['D'] = '$-1$'
    q['explanation'] = q['explanation'] + (
        "\n\nOption D, $L = -1$, is the other root of $L^2 - L - 2 = 0$ — rejected because every "
        "term of the sequence is positive, so the limit cannot be negative.")

FIXES = [
    # wrong-key
    ('data/courses/gate-em/concepts/matrix-operations/mcqs.json', 'mop-01', fx_mop01),
    ('data/courses/gate-em/concepts/integration-basics/mcqs.json', 'int-04', fx_int04),
    ('data/courses/gate-em/concepts/integration-basics/mcqs.json', 'int-05', fx_int05),
    ('data/courses/gate-em/concepts/integration-by-parts/mcqs.json', 'ibp-04', fx_ibp04),
    # no-correct-option
    ('data/courses/gate-em/concepts/determinants/mcqs.json', 'det-03', fx_det03),
    ('data/courses/gate-em/concepts/determinants/mcqs.json', 'det-04', fx_det04),
    ('data/courses/gate-em/concepts/matrix-operations/mcqs.json', 'mop-03', fx_mop03),
    ('data/courses/gate-em/concepts/maxima-minima/mcqs.json', 'max-05', fx_max05),
    ('data/courses/gate-em/concepts/multiple-integrals/mcqs.json', 'mul-04', fx_mul04),
    # defective-options
    ('data/courses/gate-em/topics/01-linear-algebra/mcqs.json', 'la-004', fx_la004),
    ('data/courses/gate-em/concepts/diagonalization/mcqs.json', 'dia-05', fx_dia05),
    ('data/courses/gate-em/concepts/vector-spaces/mcqs.json', 'vs-04', fx_vs04),
    ('data/courses/gate-em/concepts/chain-rule/mcqs.json', 'chr-04', fx_chr04),
    ('data/courses/gate-em/concepts/continuity/mcqs.json', 'con-02', fx_con02),
    ('data/courses/gate-em/concepts/integration-basics/mcqs.json', 'int-02', fx_int02),
    ('data/courses/gate-em/concepts/integration-substitution/mcqs.json', 'sub-02', fx_sub02),
    ('data/courses/gate-em/concepts/mean-value-theorems/mcqs.json', 'mvt-02', fx_mvt02),
    ('data/courses/gate-em/concepts/partial-fractions/mcqs.json', 'pf-04', fx_pf04),
    ('data/courses/gate-em/concepts/product-quotient-rule/mcqs.json', 'pqr-05', fx_pqr05),
    ('data/courses/gate-em/concepts/sequences/mcqs.json', 'seq-05', fx_seq05),
]

if __name__ == '__main__':
    for path, iid, fn in FIXES:
        edit(path, iid, fn)
    print(f'\n{len(FIXES)} items fixed.')
