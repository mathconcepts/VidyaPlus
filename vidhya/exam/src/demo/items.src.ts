/**
 * Source text for the demo build's synthetic items (demo mode only; never part of the production bundle).
 * Every item here is written for the demo: simple integrals, small matrices, dice. None comes from a
 * question bank, an official paper or a textbook (CLAUDE.md rule 7). Keys are computed from the
 * parameters, so a family can never ship a wrong key.
 *
 * Text uses the brain's convention: $...$ inline maths, $$...$$ display maths. `scripts/gen-demo-items.ts`
 * renders it with the brain's own render module into `items.generated.ts` (KaTeX HTML + MathML).
 */
export type DemoKind = 'mcq' | 'msq' | 'nat';
export type DemoVerification = 'verified' | 'rechecking' | 'withdrawn';

export interface DemoSrcItem {
  id: string;
  topic: string;
  kind: DemoKind;
  marks: 1 | 2;
  negative: string;
  stem: string;
  options?: string[];
  /** 'B', 'A,C' or '3'. */
  key: string;
  /** One or two sentences of working, with $...$ maths. */
  reason: string;
  natTolerance?: number;
  verification: DemoVerification;
}

const T = String.raw;
const LETTERS = 'ABCD';

const mat2 = (a: number, b: number, c: number, d: number): string => T`\begin{pmatrix}${a}&${b}\\${c}&${d}\end{pmatrix}`;
const mat3 = (r: number[][]): string => T`\begin{pmatrix}${r.map(x => x.join('&')).join(T`\\`)}\end{pmatrix}`;

/** Puts the correct option at a position that varies with `seed`, so keys are not always the same letter. */
function arrange(correct: string, wrong: string[], seed: number): { options: string[]; key: string } {
  const pos = seed % 4;
  const options = [...wrong.slice(0, 3)];
  options.splice(pos, 0, correct);
  return { options, key: LETTERS[pos]! };
}

type Base = Pick<DemoSrcItem, 'id' | 'topic' | 'marks' | 'verification'>;
const base = (b: Base, kind: DemoKind): Pick<DemoSrcItem, 'id' | 'topic' | 'kind' | 'marks' | 'negative' | 'verification'> => ({
  ...b,
  kind,
  negative: kind === 'mcq' ? '−⅓' : '0',
});

// ---------------------------------------------------------------- MCQ families

export function eigMcq(b: Base, a: number, c: number, seed: number): DemoSrcItem {
  const { options, key } = arrange(`$${a - c}$ and $${a + c}$`, [`$${a}$ and $${a}$`, `$0$ and $${2 * a}$`, `$${-c}$ and $${a + c}$`], seed);
  return {
    ...base(b, 'mcq'),
    stem: T`The eigenvalues of $A=${mat2(a, c, c, a)}$ are`,
    options,
    key,
    reason: T`The trace is $${2 * a}$ and the determinant is $${a * a - c * c}$, so $\lambda^2-${2 * a}\lambda+${a * a - c * c}=0$ and $\lambda=${a - c},\,${a + c}$.`,
  };
}

export function detMcq(b: Base, a: number, bb: number, c: number, d: number, seed: number): DemoSrcItem {
  const det = a * d - bb * c;
  const wrong = [a * d + bb * c, a * d, bb * c - a * d].map(v => (v === det ? v + 5 : v));
  const { options, key } = arrange(`$${det}$`, wrong.map(v => `$${v}$`), seed);
  return {
    ...base(b, 'mcq'),
    stem: T`The determinant of $A=${mat2(a, bb, c, d)}$ is`,
    options,
    key,
    reason: T`For a $2\times2$ matrix the determinant is $ad-bc=${a}\cdot${d}-${bb}\cdot${c}=${det}$.`,
  };
}

const FR: Record<number, string> = { 1: T`\frac{1}{36}`, 2: T`\frac{1}{18}`, 3: T`\frac{1}{12}`, 4: T`\frac{1}{9}`, 5: T`\frac{5}{36}`, 6: T`\frac{1}{6}` };
export function diceMcq(b: Base, sum: 4 | 5 | 7, seed: number): DemoSrcItem {
  const ways = sum === 7 ? 6 : sum - 1;
  const pool = [1, 2, 3, 4, 5, 6].filter(w => w !== ways).slice(1, 5);
  const { options, key } = arrange(`$${FR[ways]}$`, pool.map(w => `$${FR[w]}$`), seed);
  return {
    ...base(b, 'mcq'),
    stem: `Two fair dice are rolled. The probability that the sum of the faces is $${sum}$ is`,
    options,
    key,
    reason: `Exactly $${ways}$ of the $36$ equally likely outcomes give a sum of $${sum}$.`,
  };
}

export function residueMcq(b: Base, radius: 2 | 3, seed: number): DemoSrcItem {
  const one = radius === 2;
  const { options, key } = arrange(one ? T`$2\pi i$` : '$0$', one ? ['$0$', T`$\pi i$`, T`$4\pi i$`] : [T`$2\pi i$`, T`$\pi$`, T`$-2\pi i$`], seed);
  return {
    ...base(b, 'mcq'),
    stem: one ? T`The value of $\displaystyle\oint_{|z|=2}\frac{dz}{z-1}$, taken anticlockwise, is` : T`The value of $\displaystyle\oint_{|z|=3}\frac{dz}{z^2+1}$, taken anticlockwise, is`,
    options,
    key,
    reason: one
      ? T`The only pole, $z=1$, lies inside the circle with residue $1$, so the integral is $2\pi i$.`
      : T`The poles $z=\pm i$ are both inside the circle, with residues $\frac{1}{2i}$ and $-\frac{1}{2i}$. They cancel, so the integral is $0$.`,
  };
}

export function rankMcq(b: Base, seed: number): DemoSrcItem {
  const { options, key } = arrange('$2$', ['$1$', '$3$', '$0$'], seed);
  return {
    ...base(b, 'mcq'),
    stem: T`The rank of $A=${mat3([[1, 2, 3], [2, 4, 6], [1, 0, 1]])}$ is`,
    options,
    key,
    reason: T`Row 2 is twice row 1, so at most two rows are independent, and rows 1 and 3 are not proportional. The rank is $2$.`,
  };
}

export function derivMcq(b: Base, seed: number): DemoSrcItem {
  const { options, key } = arrange('$3e$', ['$e$', '$2e$', '$4e$'], seed);
  return {
    ...base(b, 'mcq'),
    stem: T`If $f(x)=x^2e^{x}$, then $f'(1)$ equals`,
    options,
    key,
    reason: T`By the product rule $f'(x)=(2x+x^2)e^{x}$, so $f'(1)=3e$.`,
  };
}

// ---------------------------------------------------------------- MSQ families

export function symmetricMsq(b: Base): DemoSrcItem {
  return {
    ...base(b, 'msq'),
    stem: T`Let $A$ be a real symmetric $n\times n$ matrix. Which of the following are true?`,
    options: [
      'All eigenvalues of $A$ are real',
      'Eigenvectors for distinct eigenvalues are orthogonal',
      T`$\det A>0$`,
      '$A$ is always invertible',
    ],
    key: 'A,B',
    reason: T`The spectral theorem gives real eigenvalues and orthogonal eigenvectors. The zero matrix is symmetric with $\det=0$, so the last two fail.`,
  };
}

export function seriesMsq(b: Base): DemoSrcItem {
  return {
    ...base(b, 'msq'),
    stem: 'Which of the following series converge?',
    options: [
      T`$\displaystyle\sum_{n=1}^{\infty}\frac{1}{n^2}$`,
      T`$\displaystyle\sum_{n=1}^{\infty}\frac{1}{n}$`,
      T`$\displaystyle\sum_{n=1}^{\infty}\frac{(-1)^n}{n}$`,
      T`$\displaystyle\sum_{n=1}^{\infty}\frac{1}{\sqrt{n}}$`,
    ],
    key: 'A,C',
    reason: T`A $p$-series converges for $p>1$, so the first does and the second and fourth do not. The third converges by the alternating series test.`,
  };
}

export function matrixRulesMsq(b: Base): DemoSrcItem {
  return {
    ...base(b, 'msq'),
    stem: T`For any two $n\times n$ matrices $A$ and $B$, which of the following always hold?`,
    options: [
      T`$\det(AB)=\det A\,\det B$`,
      T`$(AB)^{T}=B^{T}A^{T}$`,
      '$AB=BA$',
      T`$\operatorname{tr}(A+B)=\operatorname{tr}A+\operatorname{tr}B$`,
    ],
    key: 'A,B,D',
    reason: 'Matrix multiplication is not commutative in general; the other three are standard identities.',
  };
}

// ---------------------------------------------------------------- NAT families

export function integralNat(b: Base, k: number, m: number): DemoSrcItem {
  const v = k / 3 + m / 2;
  return {
    ...base(b, 'nat'),
    stem: T`The value of $\displaystyle\int_0^1\left(${k}x^2+${m}x\right)dx$ is ____`,
    key: String(v),
    reason: T`The antiderivative is $${k / 3}x^3+${m / 2}x^2$, which at $x=1$ gives $${v}$.`,
    natTolerance: 0.01,
  };
}

export function initialValueNat(b: Base, p: number, q: number, r: number): DemoSrcItem {
  return {
    ...base(b, 'nat'),
    stem: T`For $F(s)=\dfrac{${p}s+${q}}{s^2+${r}s}$, the value of $f(0^{+})$ is ____ (to one decimal place)`,
    key: String(p),
    reason: T`Initial value theorem: $f(0^{+})=\lim_{s\to\infty}sF(s)=${p}$.`,
    natTolerance: 0.05,
  };
}

export function finalValueNat(b: Base, a: number, c: number): DemoSrcItem {
  return {
    ...base(b, 'nat'),
    stem: T`For $F(s)=\dfrac{${a}}{s(s+${c})}$, the value of $\lim_{t\to\infty}f(t)$ is ____`,
    key: String(a / c),
    reason: T`Final value theorem: $\lim_{s\to0}sF(s)=\dfrac{${a}}{${c}}=${a / c}$.`,
    natTolerance: 0.01,
  };
}

export function expectationNat(b: Base, n: number): DemoSrcItem {
  return {
    ...base(b, 'nat'),
    stem: T`A fair $${n}$-sided die has faces $1,2,\dots,${n}$. The expected value of one roll is ____ (to one decimal place)`,
    key: String((n + 1) / 2),
    reason: T`$E[X]=\dfrac{1}{${n}}\sum_{k=1}^{${n}}k=\dfrac{${n}+1}{2}=${(n + 1) / 2}$.`,
    natTolerance: 0.05,
  };
}

export function largerEigNat(b: Base, a: number, c: number): DemoSrcItem {
  return {
    ...base(b, 'nat'),
    stem: T`The larger eigenvalue of $A=${mat2(a, c, c, a)}$ is ____`,
    key: String(a + c),
    reason: T`The eigenvalues of this matrix are $${a - c}$ and $${a + c}$.`,
    natTolerance: 0.01,
  };
}

export function withdrawnNat(b: Base): DemoSrcItem {
  return {
    ...base(b, 'nat'),
    stem: T`A fair coin is tossed $4$ times. The expected number of heads is ____`,
    key: '2',
    reason: T`Each toss contributes $\frac12$ on average, so $E=4\cdot\frac12=2$.`,
    natTolerance: 0.01,
  };
}

// ---------------------------------------------------------------- the sets

const v = (id: string, topic: string, marks: 1 | 2, verification: DemoVerification = 'verified'): Base => ({ id, topic, marks, verification });

/** Practice items (Today, Practise a topic). The first four are today's plan: MCQ, NAT, MSQ (re-checking), NAT. */
export const PRACTICE_SRC: DemoSrcItem[] = [
  eigMcq(v('demo-017', 'Eigenvalues', 1), 2, 1, 0),
  initialValueNat(v('demo-023', 'Laplace', 2), 3, 2, 4),
  { ...symmetricMsq(v('demo-031', 'Eigenvalues', 2, 'rechecking')) },
  integralNat(v('demo-044', 'Calculus', 2), 3, 2),
  finalValueNat(v('demo-051', 'Laplace', 2), 12, 4),
  integralNat(v('demo-045', 'Calculus', 2), 6, 4),
  expectationNat(v('demo-061', 'Probability', 1), 8),
  withdrawnNat(v('demo-062', 'Probability', 1, 'withdrawn')),
  largerEigNat(v('demo-071', 'Eigenvalues', 1), 5, 2),
];

/** The 18 mock items, 30 marks in all: 6 x 1 mark then 12 x 2 marks; every sixth is NAT, every other third is MSQ. */
export function mockSrc(): DemoSrcItem[] {
  const out: DemoSrcItem[] = [];
  const mcq = [
    (b: Base, s: number) => eigMcq(b, 3, 1, s),
    (b: Base, s: number) => detMcq(b, 3, 2, 1, 4, s),
    (b: Base, s: number) => diceMcq(b, 7, s),
    (b: Base, s: number) => residueMcq(b, 2, s),
    (b: Base, s: number) => rankMcq(b, s),
    (b: Base, s: number) => derivMcq(b, s),
    (b: Base, s: number) => detMcq(b, 5, 1, 2, 3, s),
    (b: Base, s: number) => diceMcq(b, 4, s),
    (b: Base, s: number) => residueMcq(b, 3, s),
    (b: Base, s: number) => eigMcq(b, 4, 3, s),
    (b: Base, s: number) => diceMcq(b, 5, s),
    (b: Base, s: number) => detMcq(b, 2, 3, 1, 5, s),
  ];
  const msq = [symmetricMsq, seriesMsq, matrixRulesMsq];
  const nat = [
    (b: Base) => integralNat(b, 9, 2),
    (b: Base) => initialValueNat(b, 5, 1, 3),
    (b: Base) => finalValueNat(b, 18, 6),
  ];
  let mi = 0, si = 0, ni = 0;
  for (let i = 1; i <= 18; i++) {
    const b = v(`mock-${String(i).padStart(2, '0')}`, 'Mock', i <= 6 ? 1 : 2);
    if (i % 6 === 0) out.push(nat[ni++ % nat.length]!(b));
    else if (i % 3 === 0) out.push(msq[si++ % msq.length]!(b));
    else out.push(mcq[mi % mcq.length]!(b, mi++ + 1));
  }
  return out;
}
