import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';

// The real model never loads in tests: the recogniser module is replaced by a fake.
vi.mock('../handwriting/recognizer', () => ({
  loadRecognizer: async () => async () => ({ text: '-3.75', chars: [] }),
}));
import { NatEntry } from './NatEntry';

function Host({ showWrite = true }: { showWrite?: boolean }) {
  const [v, setV] = useState('');
  return <NatEntry value={v} onChange={setV} markingNote="no negative marks" showWrite={showWrite} />;
}
const field = () => screen.getByLabelText('Your answer') as HTMLInputElement;

describe('NatEntry + handwriting (T31)', () => {
  beforeEach(() => { vi.stubEnv('VITE_EXAM_HANDWRITING', '1'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('Write opens the pad, the reading is a preview, and the answer fills only on confirm', async () => {
    render(<Host />);
    expect(screen.queryByRole('group', { name: 'Handwriting pad' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Write your answer by hand' }));
    const pad = await screen.findByRole('group', { name: 'Handwriting pad' });
    expect(pad).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close handwriting pad' })).toHaveAttribute('aria-pressed', 'true');

    const canvas = screen.getByRole('img', { name: /Writing area/ });
    await waitFor(() => expect(canvas).toHaveAccessibleDescription(/Write the number/));
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 3, clientY: 3, button: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 30, clientY: 40 });
    expect(await screen.findByText(/Read as/)).toBeInTheDocument();
    expect(field().value).toBe(''); // preview only: nothing filled yet

    fireEvent.click(screen.getByRole('button', { name: 'Use −3.75 as my answer' }));
    expect(field().value).toBe('-3.75');
    // it goes through tryParseNat as usual
    expect(screen.getByText(/Reads as/).textContent).toContain('Reads as −3.75');
    expect(screen.queryByRole('group', { name: 'Handwriting pad' })).not.toBeInTheDocument();
  });

  it('the keypad still works while the pad is open, and Escape closes the pad', async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Write your answer by hand' }));
    await screen.findByRole('group', { name: 'Handwriting pad' });
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(field().value).toBe('7');
    fireEvent.keyDown(screen.getByRole('group', { name: 'Handwriting pad' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Handwriting pad' })).not.toBeInTheDocument();
  });

  it('is absent in the mock (showWrite=false): no toggle, so no pad can open', () => {
    render(<Host showWrite={false} />);
    expect(screen.queryByRole('button', { name: /Write|handwriting/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Handwriting pad' })).not.toBeInTheDocument();
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`the open pad has no serious axe violations (${theme}, DR17)`, async () => {
      document.documentElement.setAttribute('data-theme', theme);
      const { container } = render(<Host />);
      fireEvent.click(screen.getByRole('button', { name: 'Write your answer by hand' }));
      const canvas = await screen.findByRole('img', { name: /Writing area/ });
      await waitFor(() => expect(canvas).toHaveAccessibleDescription(/Write the number/));
      const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, resultTypes: ['violations'] });
      const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map(v => `${v.id}: ${v.nodes.map(n => n.html.slice(0, 80)).join(' | ')}`)).toEqual([]);
    });
  }
});
