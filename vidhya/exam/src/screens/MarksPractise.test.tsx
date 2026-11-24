import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarksScreen } from './MarksScreen';
import { PractiseScreen } from './PractiseScreen';
import { FakeExamApi } from '../api/fake';

describe('MarksScreen', () => {
  it('one gauge that names its basis, plus "Why marks are lost" with Unclassified shown openly', async () => {
    render(<MarksScreen api={new FakeExamApi()} />);
    expect(await screen.findByText('9–12', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '9 to 12 out of 15' })).toBeInTheDocument();
    expect(screen.getByText(/Estimate from the mock and 34 practice attempts\. Last week: 8–11\./)).toBeInTheDocument();
    expect(screen.getByText('Why marks are lost')).toBeInTheDocument();
    for (const l of ['Setup error', 'Arithmetic slip', 'Concept gap', 'Unclassified']) expect(screen.getByText(l)).toBeInTheDocument();
  });
  it('empty: "Take the mock to see your marks range"', async () => {
    render(<MarksScreen api={new FakeExamApi({ marks: 'empty' })} />);
    expect(await screen.findByText('Take the mock to see your marks range')).toBeInTheDocument();
  });
  it('loading is a static skeleton', () => {
    render(<MarksScreen api={{ ...new FakeExamApi(), getMarks: () => new Promise(() => {}) } as never} />);
    expect(screen.getByLabelText('Loading your marks')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('PractiseScreen', () => {
  it('opens a topic with NAT items', async () => {
    const onOpen = vi.fn();
    render(<PractiseScreen api={new FakeExamApi()} onOpen={onOpen} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Laplace/ }));
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect(onOpen.mock.calls[0][0][0].id).toBe('gate-ec-023');
  });
  it('a topic with no NAT items says so and links to the nearest topic', async () => {
    render(<PractiseScreen api={new FakeExamApi()} onOpen={() => {}} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Probability/ }));
    expect(await screen.findByText('No NAT items in Probability yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Laplace' })).toBeInTheDocument();
  });
});
