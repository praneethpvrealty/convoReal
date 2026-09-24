import { describe, expect, it } from 'vitest';

import { conversionTitle } from './conversion';
import {
  isClosingRecord,
  transactionPropertyLabel,
  transactionSubtitle,
  transactionTitle,
  expectedCloseLabel,
  sortIndexRows,
} from './index-row';

const base = {
  title: 'Kundanlala — 3BHK near Whitefield',
  contact_name: 'Kundanlala',
  property_title: 'Sky Tower',
  property_unit_no: null,
};

describe('[TXW-016] the index names a transaction by buyer and property', () => {
  it('leads with the buyer and the property, unit number first', () => {
    expect(transactionTitle(base)).toBe('Kundanlala — Sky Tower');
    expect(transactionTitle({ ...base, property_unit_no: ' 12B ' })).toBe(
      'Kundanlala — Property No. 12B'
    );
  });

  it('demotes a requirement-style deal title to the second line', () => {
    expect(transactionSubtitle(base)).toBe('Kundanlala — 3BHK near Whitefield');
  });

  it('never repeats a converted deal title beneath its own headline', () => {
    const item = {
      contact: { name: 'Dr Ravi', phone: '919900000000' },
      property: { title: 'Sky Tower', unit_no: '12B' },
    };
    const row = {
      title: conversionTitle(item as Parameters<typeof conversionTitle>[0]),
      contact_name: 'Dr Ravi',
      property_title: 'Sky Tower',
      property_unit_no: '12B',
    };
    expect(transactionTitle(row)).toBe(row.title);
    expect(transactionSubtitle(row)).toBeNull();
  });

  it('falls back to whichever party is known, then to the deal title', () => {
    expect(
      transactionTitle({
        ...base,
        property_title: null,
        property_unit_no: null,
      })
    ).toBe('Kundanlala');
    expect(transactionTitle({ ...base, contact_name: '  ' })).toBe('Sky Tower');
    expect(
      transactionTitle({
        ...base,
        contact_name: null,
        property_title: null,
      })
    ).toBe(base.title);
    expect(
      transactionSubtitle({
        ...base,
        contact_name: null,
        property_title: null,
      })
    ).toBeNull();
    expect(transactionSubtitle({ ...base, title: 'kundanlala' })).toBeNull();
    expect(
      transactionPropertyLabel({ property_title: '', property_unit_no: '' })
    ).toBeNull();
  });
});

describe('[TXW-016] a pipeline deal becomes a transaction through provenance or milestones', () => {
  it('marks a converted journey as a closing record whatever its checklist', () => {
    expect(
      isClosingRecord({ source_journey_item_id: 'j1', milestones_total: 0 })
    ).toBe(true);
  });

  it('marks a board deal with milestones as a closing record', () => {
    expect(
      isClosingRecord({ source_journey_item_id: null, milestones_total: 3 })
    ).toBe(true);
  });

  it('leaves an early-stage board deal without milestones outside', () => {
    expect(
      isClosingRecord({ source_journey_item_id: null, milestones_total: 0 })
    ).toBe(false);
  });
});

describe('[TXW-022] the Records index carries the expected close date', () => {
  const today = '2026-10-01';

  it('labels the forecast, its passing, and the actual close', () => {
    expect(
      expectedCloseLabel(
        { expected_close_date: null, actual_close_date: null },
        today
      )
    ).toBeNull();
    expect(
      expectedCloseLabel(
        { expected_close_date: '2026-10-05', actual_close_date: null },
        today
      )
    ).toEqual({ text: 'Closes 2026-10-05', tone: 'soon' });
    expect(
      expectedCloseLabel(
        { expected_close_date: '2026-10-25', actual_close_date: null },
        today
      )
    ).toEqual({ text: 'Closes 2026-10-25', tone: 'later' });
    expect(
      expectedCloseLabel(
        { expected_close_date: '2026-09-28', actual_close_date: null },
        today
      )
    ).toEqual({ text: 'Close date passed (2026-09-28)', tone: 'overdue' });
    expect(
      expectedCloseLabel(
        { expected_close_date: '2026-09-28', actual_close_date: '2026-09-30' },
        today
      )
    ).toEqual({ text: 'Closed 2026-09-30', tone: 'done' });
  });

  it('sorts by close date with undated after dated and closed deals last', () => {
    const rows = [
      {
        id: 'closed',
        expected_close_date: '2026-09-01',
        actual_close_date: '2026-09-02',
        updated_at: '2026-09-24T00:00:00Z',
      },
      {
        id: 'undated',
        expected_close_date: null,
        actual_close_date: null,
        updated_at: '2026-09-25T00:00:00Z',
      },
      {
        id: 'later',
        expected_close_date: '2026-11-01',
        actual_close_date: null,
        updated_at: '2026-09-20T00:00:00Z',
      },
      {
        id: 'soon',
        expected_close_date: '2026-10-10',
        actual_close_date: null,
        updated_at: '2026-09-10T00:00:00Z',
      },
    ];
    expect(sortIndexRows(rows, 'close').map((r) => r.id)).toEqual([
      'soon',
      'later',
      'undated',
      'closed',
    ]);
    expect(sortIndexRows(rows, 'updated').map((r) => r.id)).toEqual([
      'closed',
      'undated',
      'later',
      'soon',
    ]);
  });
});
