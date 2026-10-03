// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageSquare } from 'lucide-react';

import { MetricCard, deltaCopy } from './metric-card';

afterEach(cleanup);

function renderDelta(
  value: number,
  direction?: 'higher-is-better' | 'neutral'
) {
  render(
    <MetricCard
      title="Metric"
      value="10"
      icon={MessageSquare}
      delta={{ value, direction }}
    />
  );
  return screen.getByText(deltaCopy(value)).parentElement!;
}

describe('MetricCard delta', () => {
  it('words the delta without a sign', () => {
    expect(deltaCopy(-2)).toBe('2 fewer than yesterday');
    expect(deltaCopy(3)).toBe('3 more than yesterday');
    expect(deltaCopy(0)).toBe('Same as yesterday');
    expect(deltaCopy(-1200)).toBe(
      `${(1200).toLocaleString()} fewer than yesterday`
    );
  });

  it('never renders a minus or plus sign next to the arrow', () => {
    const row = renderDelta(-10);
    expect(row.textContent).toBe('10 fewer than yesterday');
    expect(row.textContent).not.toMatch(/[-+]/);
  });

  it('colours a drop red and a rise with the accent when higher is better', () => {
    expect(renderDelta(-2).className).toContain('text-red-400');
    cleanup();
    expect(renderDelta(3).className).toContain('text-primary');
  });

  it('keeps a neutral metric slate in both directions', () => {
    expect(renderDelta(-2, 'neutral').className).toContain('text-slate-400');
    cleanup();
    expect(renderDelta(4, 'neutral').className).toContain('text-slate-400');
  });

  it('keeps no change slate', () => {
    expect(renderDelta(0).className).toContain('text-slate-400');
  });
});
