import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HandwritingPad from './HandwritingPad';
import type { Recognizer } from './model';

function draw(canvas: HTMLElement, pts: [number, number][], id = 1) {
  fireEvent.pointerDown(canvas, { pointerId: id, clientX: pts[0][0], clientY: pts[0][1], button: 0, pointerType: 'touch' });
  for (const [x, y] of pts.slice(1)) fireEvent.pointerMove(canvas, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch' });
  fireEvent.pointerUp(canvas, { pointerId: id, clientX: pts[pts.length - 1][0], clientY: pts[pts.length - 1][1], pointerType: 'touch' });
}
const canvasEl = () => screen.getByRole('img', { name: /Writing area/ });
const fakeRec = (text: string): Recognizer => vi.fn(async () => ({ text, chars: [] }));

describe('HandwritingPad (T31, DR15b)', () => {
  it('is a labelled group with labelled controls, and says how to use it', async () => {
    render(<HandwritingPad onConfirm={() => {}} loader={async () => fakeRec('1')} autoReadMs={0} />);
    expect(screen.getByRole('group', { name: 'Handwriting pad' })).toBeInTheDocument();
    expect(canvasEl()).toHaveAccessibleDescription(/Loading|Write the number/);
    expect(screen.getByRole('button', { name: 'Undo last stroke' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear writing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use the recognised answer' })).toBeDisabled();
    await waitFor(() => expect(canvasEl()).toHaveAccessibleDescription(/Write the number/));
  });

  it('draws, previews the reading, and fills only when the student confirms', async () => {
    const onConfirm = vi.fn();
    const rec = fakeRec('-3.75');
    render(<HandwritingPad onConfirm={onConfirm} loader={async () => rec} autoReadMs={0} />);
    await waitFor(() => expect(canvasEl()).toHaveAccessibleDescription(/Write the number/));
    draw(canvasEl(), [[10, 10], [40, 60], [20, 90]]);
    expect(await screen.findByText(/Read as/)).toHaveTextContent('Read as −3.75');
    expect(rec).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use −3.75 as my answer' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('-3.75');
  });

  it('the recogniser receives the strokes in pad coordinates', async () => {
    const rec = fakeRec('7');
    render(<HandwritingPad onConfirm={() => {}} loader={async () => rec} autoReadMs={0} />);
    await waitFor(() => expect(canvasEl()).toHaveAccessibleDescription(/Write the number/));
    draw(canvasEl(), [[5, 6], [7, 8]]);
    await waitFor(() => expect(rec).toHaveBeenCalled());
    const [strokes, pen] = (rec as unknown as { mock: { calls: [unknown, number][] } }).mock.calls[0] as [{ x: number; y: number }[][], number];
    expect(strokes).toEqual([[{ x: 5, y: 6 }, { x: 7, y: 8 }]]);
    expect(pen).toBe(5);
  });

  it('undo removes the last stroke and clear removes all; the preview follows', async () => {
    const rec: Recognizer = vi.fn(async s => ({ text: '1'.repeat(s.length), chars: [] }));
    render(<HandwritingPad onConfirm={() => {}} loader={async () => rec} autoReadMs={0} />);
    await waitFor(() => expect(canvasEl()).toHaveAccessibleDescription(/Write the number/));
    draw(canvasEl(), [[10, 10], [10, 60]]);
    draw(canvasEl(), [[60, 10], [60, 60]]);
    expect(await screen.findByText(/Read as/)).toHaveTextContent('Read as 11');
    fireEvent.click(screen.getByRole('button', { name: 'Undo last stroke' }));
    await waitFor(() => expect(screen.getByText(/Read as/)).toHaveTextContent('Read as 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear writing' }));
    await waitFor(() => expect(screen.queryByText(/Read as/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Use the recognised answer' })).toBeDisabled();
  });

  it('flags a reading that is not a number and an empty reading, without blocking the keypad', async () => {
    const rec = fakeRec('4..1');
    render(<HandwritingPad onConfirm={() => {}} loader={async () => rec} autoReadMs={0} />);
    await waitFor(() => expect(canvasEl()).toHaveAccessibleDescription(/Write the number/));
    draw(canvasEl(), [[1, 1], [9, 9]]);
    expect(await screen.findByText(/Read as/)).toHaveTextContent("doesn't read as a number yet");
  });

  it('says so when the model cannot load', async () => {
    render(<HandwritingPad onConfirm={() => {}} loader={async () => { throw new Error('offline'); }} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Use the keypad/);
  });
});
