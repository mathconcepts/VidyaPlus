import { describe, it, expect } from 'vitest';
import { parseNatInput } from '../nat-input.js';

describe('parseNatInput', () => {
  it.each([['2.45', 2.45], [' -0.5 ', -0.5], ['1e-3', 0.001], ['.5', 0.5], ['+3', 3], ['7.', 7]])('%s → %d', (s, v) => {
    expect(parseNatInput(s)).toBe(v);
  });
  it.each(['', '2,45', '1/3', 'abc', '--1', '1e', 'NaN', 'Infinity', '9'.repeat(65)])('refuses %j', (s) => {
    expect(() => parseNatInput(s)).toThrow('NatParseError');
  });
});
