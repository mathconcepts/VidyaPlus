/**
 * Feature flags for the /exam app. Handwriting (T31, DR15b) is practice-only and
 * first in the cut order. It is OFF unless the build sets VITE_EXAM_HANDWRITING=1.
 * It stays off until the recogniser reads at least 95% of held-out strings exactly
 * (handwriting/eval.test.ts checks that this flag and the measured number agree)
 * and a human has run the plan's 50-real-samples check on a phone.
 */
export const handwritingEnabled = (): boolean => import.meta.env.VITE_EXAM_HANDWRITING === '1';
