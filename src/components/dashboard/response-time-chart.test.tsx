// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { ResponseTimeSummary } from '@/lib/dashboard/types';
import { ResponseTimeChart } from './response-time-chart';

afterEach(cleanup);

function summary(
  minutes: (number | null)[],
  thisWeekAvg: number | null,
  lastWeekAvg: number | null
): ResponseTimeSummary {
  return {
    buckets: minutes.map((avgMinutes, dow) => ({
      dow,
      avgMinutes,
      samples: avgMinutes == null ? 0 : 1,
    })),
    thisWeekAvg,
    lastWeekAvg,
  };
}

describe('ResponseTimeChart', () => {
  it('shows the empty state when the largest value is zero', () => {
    render(
      <ResponseTimeChart
        data={summary([0, 0, null, null, null, null, null], 0, null)}
        loading={false}
      />
    );
    expect(screen.getByText('No replies measured yet')).toBeTruthy();
  });

  it('shows this week and last week in one unit', () => {
    render(
      <ResponseTimeChart
        data={summary([66, 52.4, null, null, null, null, null], 66, 52.4)}
        loading={false}
      />
    );
    expect(screen.getByText('1.1h')).toBeTruthy();
    expect(screen.getByText('0.9h')).toBeTruthy();
    expect(screen.queryByText('52.4m')).toBeNull();
    expect(screen.queryByText('No replies measured yet')).toBeNull();
  });
});
