import { describe, expect, it } from 'vitest';
import {
  buildFunnelSteps,
  completionRate,
  formatDurationSeconds,
  successRate,
} from './analytics';

describe('successRate / completionRate', () => {
  it('computes percentages and returns null with no runs', () => {
    expect(successRate({ runs: 20, succeeded: 15 })).toBeCloseTo(75);
    expect(successRate({ runs: 0, succeeded: 0 })).toBeNull();
    expect(completionRate({ runs: 8, completed: 2 })).toBeCloseTo(25);
    expect(completionRate({ runs: 0, completed: 0 })).toBeNull();
  });
});

describe('buildFunnelSteps', () => {
  it('computes share-of-started and step drop-off', () => {
    const steps = buildFunnelSteps([
      { node_key: 'start', node_type: 'start', runs_entered: 100 },
      { node_key: 'ask_budget', node_type: 'collect_input', runs_entered: 80 },
      { node_key: 'send_matches', node_type: 'send_list', runs_entered: 40 },
    ]);

    expect(steps[0].pctOfStarted).toBe(100);
    expect(steps[0].dropOffPct).toBeNull();
    expect(steps[1].pctOfStarted).toBeCloseTo(80);
    expect(steps[1].dropOffPct).toBeCloseTo(20);
    expect(steps[2].pctOfStarted).toBeCloseTo(40);
    expect(steps[2].dropOffPct).toBeCloseTo(50);
  });

  it('handles empty input', () => {
    expect(buildFunnelSteps([])).toEqual([]);
  });
});

describe('formatDurationSeconds', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDurationSeconds(null)).toBe('—');
    expect(formatDurationSeconds(45)).toBe('45s');
    expect(formatDurationSeconds(150)).toBe('2.5m');
    expect(formatDurationSeconds(7200)).toBe('2.0h');
  });
});
