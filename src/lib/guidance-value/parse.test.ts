import { describe, expect, it } from 'vitest';

import { countPdfPages, sanitiseRateRows } from './rate-parse';
import { isScheduleMimeType, sanitiseSchedule } from './schedule-fields';
import { normaliseUnit, parseArea, toSqft } from './units';

describe('units', () => {
  it('normalises the spellings deeds and notifications use', () => {
    expect(normaliseUnit('Sft.')).toBe('sqft');
    expect(normaliseUnit('Sq. Mtrs')).toBe('sqm');
    expect(normaliseUnit('Guntas')).toBe('gunta');
    expect(normaliseUnit('Acres')).toBe('acre');
    expect(normaliseUnit('cents')).toBeNull();
  });

  it('parses areas with commas and converts to sq.ft', () => {
    expect(parseArea({ value: '4,319', unit: 'Sft' })).toEqual({
      value: 4319,
      unit: 'sqft',
    });
    expect(parseArea({ value: 0, unit: 'sqft' })).toBeNull();
    expect(toSqft({ value: 1, unit: 'gunta' })).toBe(1089);
  });
});

describe('sanitiseSchedule', () => {
  it('keeps the fields of the Koramangala schedule and drops junk', () => {
    const schedule = sanitiseSchedule({
      district: 'Bengaluru Urban',
      locality: '  Koramangala 6th Block ',
      road: '18th Main',
      pincode: '560 095',
      pid: '67-8-436',
      kind: 'House',
      usage: 'residential',
      built_up_area: { value: '4319', unit: 'Sft.' },
      land_area: { value: 'unknown', unit: 'sqft' },
      floors: [
        { label: 'Ground', area: { value: 1916, unit: 'sft' } },
        { label: '', area: { value: 10, unit: 'sft' } },
      ],
      boundaries: {
        east: 'Property 464 & 465',
        west: '18th Main Road',
        up: 'x',
      },
      extra: 'ignored',
    });
    expect(schedule).toEqual({
      district: 'Bengaluru Urban',
      locality: 'Koramangala 6th Block',
      road: '18th Main',
      pincode: '560095',
      pid: '67-8-436',
      kind: 'house',
      usage: 'residential',
      built_up_area: { value: 4319, unit: 'sqft' },
      floors: [{ label: 'Ground', area: { value: 1916, unit: 'sqft' } }],
      boundaries: { east: 'Property 464 & 465', west: '18th Main Road' },
    });
  });

  it('returns an empty schedule for non-objects', () => {
    expect(sanitiseSchedule(null)).toEqual({});
    expect(sanitiseSchedule('text')).toEqual({});
  });

  it('accepts PDFs and photos only', () => {
    expect(isScheduleMimeType('application/pdf')).toBe(true);
    expect(isScheduleMimeType('IMAGE/JPEG')).toBe(true);
    expect(isScheduleMimeType('image/heic')).toBe(false);
  });
});

describe('sanitiseRateRows', () => {
  it('keeps valid rows, clamps pages into the chunk and drops the rest', () => {
    const { rows, totalPages } = sanitiseRateRows(
      {
        total_pages: 40,
        rows: [
          {
            district: 'Bengaluru Urban',
            locality: 'Koramangala 6th Block',
            road: '18th Main',
            property_class: 'Residential Site',
            rate: '2,10,000',
            unit: 'Sq.Mtr',
            page: 99,
          },
          { locality: 'X', property_class: 'villa', rate: 1, unit: 'sqm' },
          { locality: 'X', property_class: 'industrial', rate: 0, unit: 'sqm' },
          { property_class: 'industrial', rate: 10, unit: 'sqm' },
        ],
      },
      3,
      4
    );
    expect(totalPages).toBe(40);
    expect(rows).toEqual([
      {
        district: 'Bengaluru Urban',
        locality: 'Koramangala 6th Block',
        road: '18th Main',
        property_class: 'residential_site',
        rate: 210000,
        unit: 'sqm',
        page: 3,
      },
    ]);
  });

  it('counts pages in an uncompressed PDF', () => {
    const pdf = new TextEncoder().encode(
      '<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>'
    );
    expect(countPdfPages(pdf)).toBe(2);
    expect(countPdfPages(new Uint8Array())).toBeNull();
  });
});
