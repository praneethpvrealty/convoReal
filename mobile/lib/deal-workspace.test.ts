import { describe, expect, it } from 'vitest';

import {
  categoryLabel,
  extractionEntries,
  isClosingRecord,
  isReadable,
  transactionSubtitle,
  transactionTitle,
  DEAL_DOCUMENT_CATEGORIES,
  INVOICE_STATUS_LABELS,
} from './deal-workspace';

describe('categoryLabel', () => {
  it('names every category it offers', () => {
    for (const option of DEAL_DOCUMENT_CATEGORIES) {
      expect(categoryLabel(option.value)).toBe(option.label);
    }
  });

  it('falls back to the raw value for an unknown category', () => {
    expect(categoryLabel('something_new')).toBe('something_new');
  });
});

describe('isReadable', () => {
  it('accepts what the extractor can actually read', () => {
    expect(isReadable('application/pdf')).toBe(true);
    expect(isReadable('image/jpeg')).toBe(true);
    expect(isReadable('IMAGE/PNG')).toBe(true);
  });

  it('refuses a HEIC, which uploads fine but cannot be read', () => {
    expect(isReadable('image/heic')).toBe(false);
    expect(isReadable(null)).toBe(false);
    expect(isReadable(undefined)).toBe(false);
  });
});

describe('extractionEntries', () => {
  it('labels the fields an identity document yields', () => {
    const entries = extractionEntries({
      name: 'Pruthvi Rao',
      address_lines: ['No. 268, 8th Cross', 'Bengaluru - 560098'],
      aadhaar_last4: '9012',
    });
    expect(entries.map((e) => e.label)).toEqual([
      'Name',
      'Address',
      'Aadhaar (last 4)',
    ]);
    expect(entries[1].value).toBe('No. 268, 8th Cross\nBengaluru - 560098');
  });

  it('drops empty and missing fields instead of showing blank rows', () => {
    const entries = extractionEntries({
      name: 'Pruthvi Rao',
      pan: '',
      parties: [],
      notes: null,
      pincode: undefined,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('name');
  });

  it('is empty when nothing has been read', () => {
    expect(extractionEntries(null)).toEqual([]);
    expect(extractionEntries(undefined)).toEqual([]);
    expect(extractionEntries({})).toEqual([]);
  });

  it('shows an unrecognised key rather than hiding it', () => {
    const entries = extractionEntries({ mystery_field: 'something' });
    expect(entries[0]).toMatchObject({
      key: 'mystery_field',
      label: 'mystery_field',
      value: 'something',
    });
  });
});

describe('invoice status labels', () => {
  it('covers every status the API can return', () => {
    expect(Object.keys(INVOICE_STATUS_LABELS).sort()).toEqual([
      'cancelled',
      'draft',
      'issued',
      'paid',
      'sent',
    ]);
  });
});

describe('[TXW-016] the deals list names a transaction by buyer and property', () => {
  const base = {
    title: 'Kundanlala — 3BHK near Whitefield',
    contact_name: 'Kundanlala',
    property_title: 'Sky Tower',
    property_unit_no: null,
  };

  it('leads with the buyer and the property, unit number first', () => {
    expect(transactionTitle(base)).toBe('Kundanlala — Sky Tower');
    expect(transactionTitle({ ...base, property_unit_no: '12B' })).toBe(
      'Kundanlala — Property No. 12B'
    );
  });

  it('demotes the deal title to the second line and hides it when repeated', () => {
    expect(transactionSubtitle(base)).toBe('Kundanlala — 3BHK near Whitefield');
    expect(
      transactionSubtitle({
        ...base,
        title: 'Kundanlala — Property No. 12B',
        property_unit_no: '12B',
      })
    ).toBeNull();
    expect(
      transactionTitle({ ...base, contact_name: null, property_title: null })
    ).toBe(base.title);
  });

  it('treats provenance or milestones as the mark of a closing record', () => {
    expect(
      isClosingRecord({ source_journey_item_id: 'j1', milestones_total: 0 })
    ).toBe(true);
    expect(
      isClosingRecord({ source_journey_item_id: null, milestones_total: 2 })
    ).toBe(true);
    expect(
      isClosingRecord({ source_journey_item_id: null, milestones_total: 0 })
    ).toBe(false);
  });
});
