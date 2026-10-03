import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiFetch: async () => ({}) }));

import {
  groupDeadlinesByDeal,
  isStaleRequest,
  requestBadge,
  summarizeDeadlines,
  summarizeRequests,
  type FocusDeadline,
} from './focus';

function deadline(over: Partial<FocusDeadline>): FocusDeadline {
  return {
    dealId: 'deal-1',
    kind: 'milestone',
    milestoneId: 'm1',
    title: 'Registration scheduled',
    subject: 'Asha Rao · Palm Villa',
    dueDate: '2026-10-05',
    daysLeft: 2,
    urgency: 'soon',
    assignedTo: null,
    ownerUserId: null,
    ...over,
  };
}

describe('groupDeadlinesByDeal', () => {
  it('[TXW-020] gives two deals of the same contact and property one row each, listing both milestones once', () => {
    const rows = ['deal-1', 'deal-2'].flatMap((dealId) => [
      deadline({ dealId, milestoneId: `${dealId}:a` }),
      deadline({
        dealId,
        milestoneId: `${dealId}:b`,
        title: 'Sale deed registered',
        dueDate: '2026-10-07',
        daysLeft: 4,
      }),
    ]);
    const groups = groupDeadlinesByDeal(rows);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.titles).toEqual([
        'Registration scheduled',
        'Sale deed registered',
      ]);
      expect(group.items).toHaveLength(2);
      expect(group.dueDate).toBe('2026-10-05');
      expect(group.daysLeft).toBe(2);
      expect(group.urgency).toBe('soon');
    }
    expect(summarizeDeadlines(groups).total).toBe(2);
  });

  it('dedupes repeated titles and takes the earliest date and urgency', () => {
    const [group] = groupDeadlinesByDeal([
      deadline({ milestoneId: 'x', dueDate: '2026-10-09', daysLeft: 6 }),
      deadline({
        milestoneId: 'y',
        dueDate: '2026-10-01',
        daysLeft: -2,
        urgency: 'overdue',
      }),
    ]);
    expect(group.titles).toEqual(['Registration scheduled']);
    expect(group.dueDate).toBe('2026-10-01');
    expect(group.urgency).toBe('overdue');
    expect(group.items).toHaveLength(2);
  });

  it('orders deals by their earliest date', () => {
    const groups = groupDeadlinesByDeal([
      deadline({ dealId: 'late', dueDate: '2026-10-10' }),
      deadline({ dealId: 'early', dueDate: '2026-10-02' }),
    ]);
    expect(groups.map((g) => g.dealId)).toEqual(['early', 'late']);
  });
});

describe('request age badge', () => {
  it('[TXW-020] shows the age in days for a request that waited 72 hours and is not urgent', () => {
    expect(requestBadge({ urgency: 'soon', ageHours: 72 })).toEqual({
      label: '3 d',
      urgency: 'later',
    });
    expect(requestBadge({ urgency: 'later', ageHours: 1950 })).toEqual({
      label: '81 d',
      urgency: 'later',
    });
  });

  it('keeps the urgency label under 72 hours and for a request needing an answer now', () => {
    expect(requestBadge({ urgency: 'soon', ageHours: 71 })).toEqual({
      label: 'Soon',
      urgency: 'soon',
    });
    expect(requestBadge({ urgency: 'now', ageHours: 500 })).toEqual({
      label: 'Now',
      urgency: 'now',
    });
    expect(isStaleRequest({ urgency: 'now', ageHours: 500 })).toBe(false);
  });

  it('headlines the requests needing an answer now and counts the stale ones', () => {
    expect(
      summarizeRequests([
        { urgency: 'now', ageHours: 10 },
        { urgency: 'soon', ageHours: 80 },
        { urgency: 'later', ageHours: 5 },
      ])
    ).toEqual({
      now: 1,
      stale: 1,
      total: 3,
      summary:
        '1 needing an answer now · 3 open in total · 1 waiting over 3 days',
    });
    expect(summarizeRequests([{ urgency: 'now', ageHours: 5 }]).summary).toBe(
      '1 needing an answer now · 1 open in total'
    );
    expect(summarizeRequests([]).summary).toBe('');
  });
});
