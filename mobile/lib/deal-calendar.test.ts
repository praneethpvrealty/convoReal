import { describe, expect, it } from 'vitest';

import {
  DEAL_DATE_HORIZON_DAYS,
  DEAL_DATE_KIND_LABELS,
  daysBetween,
  dealDateHref,
  dealDateKey,
  dealDateLocalDay,
  dealDatesInRange,
  groupDealDatesByDate,
  localDateKey,
  toDealDate,
  type DealDate,
  type DealDateRow,
} from './deal-calendar';

function row(over: Partial<DealDateRow> = {}): DealDateRow {
  return {
    deal_id: 'deal-1',
    deal_title: 'Adithi — Site 19',
    contact_name: 'Adithi',
    property_title: 'Green Acres',
    property_unit_no: '19',
    kind: 'milestone',
    milestone_id: 'ms-1',
    title: 'Registration scheduled',
    due_date: '2026-10-10',
    assigned_to: null,
    owner_user_id: null,
    ...over,
  };
}

function deadline(over: Partial<DealDate>): DealDate {
  return {
    dealId: 'deal-1',
    kind: 'milestone',
    milestoneId: 'ms-1',
    title: 'Registration scheduled',
    subject: 'Adithi — Property No. 19',
    dueDate: '2026-10-10',
    daysLeft: 11,
    urgency: 'soon',
    assignedTo: null,
    ownerUserId: null,
    ...over,
  };
}

describe('[CAL-008] deal dates on the mobile calendar', () => {
  it('turns a deadline row into the same shape and subject as the web', () => {
    const d = toDealDate(row(), '2026-09-29');
    expect(d).toEqual({
      dealId: 'deal-1',
      kind: 'milestone',
      milestoneId: 'ms-1',
      title: 'Registration scheduled',
      subject: 'Adithi — Property No. 19',
      dueDate: '2026-10-10',
      daysLeft: 11,
      urgency: 'soon',
      assignedTo: null,
      ownerUserId: null,
    });
    expect(
      toDealDate(row({ due_date: '2026-09-29' }), '2026-09-29').urgency
    ).toBe('today');
    expect(
      toDealDate(row({ due_date: '2026-09-20' }), '2026-09-29').urgency
    ).toBe('overdue');
    expect(daysBetween('2026-09-29', '2026-09-20')).toBe(-9);
  });

  it('reads every open date, however far out', () => {
    expect(DEAL_DATE_HORIZON_DAYS).toBeGreaterThanOrEqual(365 * 100);
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
    expect(dealDateHref('deal-1')).toBe('/(app)/deal/deal-1');
  });

  it('places a date-only value on the local day', () => {
    const day = dealDateLocalDay('2026-10-10');
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([
      2026, 9, 10,
    ]);
    expect(localDateKey(day)).toBe('2026-10-10');
  });

  it('labels the three kinds for the chip', () => {
    expect(DEAL_DATE_KIND_LABELS).toEqual({
      milestone: 'Milestone',
      payment: 'Payment due',
      expected_close: 'Expected close',
    });
  });
});
