import { describe, expect, it } from 'vitest';

import type { DealDeadline } from '@/lib/deals/deadlines';

import {
  DEAL_DATE_KIND_LABELS,
  DEAL_DATE_MIN_HORIZON_DAYS,
  dealDateHorizonDays,
  dealDateHref,
  dealDateKey,
  dealDateLocalDay,
  dealDatesInRange,
  groupDealDatesByDate,
  localDateKey,
} from './deal-dates';

function deadline(over: Partial<DealDeadline>): DealDeadline {
  return {
    dealId: 'deal-1',
    kind: 'milestone',
    milestoneId: 'ms-1',
    title: 'Registration scheduled',
    subject: 'Adithi — Property No. 19',
    dueDate: '2026-10-10',
    daysLeft: 11,
    urgency: 'soon',
    ...over,
  };
}

describe('[CAL-008] deal dates on the calendar', () => {
  it('reads at least a year ahead and widens for a range further out', () => {
    expect(dealDateHorizonDays('2026-09-29', '2026-10-31')).toBe(
      DEAL_DATE_MIN_HORIZON_DAYS
    );
    expect(dealDateHorizonDays('2026-09-29', '2028-01-15')).toBe(
      DEAL_DATE_MIN_HORIZON_DAYS + 108
    );
    expect(dealDateHorizonDays('2026-09-29', '2026-08-01')).toBe(
      DEAL_DATE_MIN_HORIZON_DAYS
    );
  });

  it('keeps only the rows inside the visible range, soonest first', () => {
    const rows = [
      deadline({ dueDate: '2026-11-01', title: 'Next month' }),
      deadline({
        dueDate: '2026-10-10',
        kind: 'expected_close',
        milestoneId: null,
        title: 'Expected close',
      }),
      deadline({ dueDate: '2026-10-10', title: 'Registration scheduled' }),
      deadline({ dueDate: '2026-09-30', title: 'Last day before' }),
      deadline({
        dueDate: '2026-10-03',
        kind: 'payment',
        milestoneId: 't-1',
        title: 'Payment: On agreement',
      }),
    ];
    expect(
      dealDatesInRange(rows, '2026-10-01', '2026-10-31').map(
        (d) => `${d.dueDate} ${d.title}`
      )
    ).toEqual([
      '2026-10-03 Payment: On agreement',
      '2026-10-10 Registration scheduled',
      '2026-10-10 Expected close',
    ]);
    expect(dealDatesInRange(rows, '2026-10-31', '2026-10-01')).toEqual([]);
    expect(dealDatesInRange(rows, 'nope', '2026-10-01')).toEqual([]);
  });

  it('groups by due date with milestones ahead of the close they add up to', () => {
    const grouped = groupDealDatesByDate([
      deadline({
        dueDate: '2026-10-10',
        kind: 'expected_close',
        milestoneId: null,
        title: 'Expected close',
      }),
      deadline({ dueDate: '2026-10-10' }),
      deadline({
        dueDate: '2026-10-03',
        kind: 'payment',
        milestoneId: 't-1',
        title: 'Payment: Token',
      }),
    ]);
    expect([...grouped.keys()]).toEqual(['2026-10-03', '2026-10-10']);
    expect(grouped.get('2026-10-10')!.map((d) => d.kind)).toEqual([
      'milestone',
      'expected_close',
    ]);
  });

  it('keys a milestone by its id and the close by the deal, and links to the record', () => {
    expect(dealDateKey(deadline({}))).toBe('deal-1:ms-1');
    expect(
      dealDateKey(deadline({ kind: 'expected_close', milestoneId: null }))
    ).toBe('deal-1:expected_close');
    expect(dealDateHref('deal-1')).toBe('/deals/deal-1');
  });

  it('places a date-only value on the local day, not the UTC one', () => {
    const day = dealDateLocalDay('2026-10-10');
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([
      2026, 9, 10,
    ]);
    expect(day.getHours()).toBe(0);
    expect(localDateKey(day)).toBe('2026-10-10');
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('labels the three kinds for the chip', () => {
    expect(DEAL_DATE_KIND_LABELS).toEqual({
      milestone: 'Milestone',
      payment: 'Payment due',
      expected_close: 'Expected close',
    });
  });
});
