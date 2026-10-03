import { describe, expect, it } from 'vitest';

import {
  groupDeadlinesByDeal,
  summarizeDeadlines,
  type DealDeadline,
} from './deadline-rules';

function deadline(over: Partial<DealDeadline>): DealDeadline {
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
