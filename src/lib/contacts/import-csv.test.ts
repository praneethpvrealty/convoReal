import { describe, it, expect } from 'vitest';
import { parseContactsCsv } from './import-csv';

describe('parseContactsCsv', () => {
  it('parses rows with quoted fields and flexible header names', () => {
    const csv = [
      'phone,name,email,company,tags,areas of interest,min budget,max budget,preferences',
      '+919876543210,John Doe,john@example.com,MagicBricks,"Hot, Buyer",Whitefield,10000000,15000000,3 BHK apartment in Whitefield',
    ].join('\n');
    const rows = parseContactsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      phone: '+919876543210',
      name: 'John Doe',
      company: 'MagicBricks',
      tags: 'Hot, Buyer',
      areas_of_interest: 'Whitefield',
      min_budget: 10000000,
      max_budget: 15000000,
      notes: '3 BHK apartment in Whitefield',
    });
  });

  it('requires a phone header and skips rows without a phone', () => {
    expect(parseContactsCsv('name,email\nJohn,john@example.com')).toEqual([]);
    const rows = parseContactsCsv(
      'phone,name\n,No Phone\n+911234567890,Has Phone'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Has Phone');
  });

  it('splits a trailing qualifier off the name when no name_tag column exists', () => {
    const rows = parseContactsCsv('phone,name\n+911234567890,Nataraj Bank DSA');
    expect(rows[0].name).toBe('Nataraj');
    expect(rows[0].name_tag).toBe('Bank DSA');
  });
});

describe('parseContactsCsv — enquired property', () => {
  it('picks up the property reference under any portal header name', () => {
    for (const header of [
      'property_id',
      'property code',
      'portal_listing_id',
      'listing id',
      'property',
    ]) {
      const rows = parseContactsCsv(`phone,${header}\n+911234567890,PROP-1018`);
      expect(rows[0].property_ref, header).toBe('PROP-1018');
    }
  });

  it('leaves property_ref undefined when the CSV has no such column', () => {
    const rows = parseContactsCsv('phone,name\n+911234567890,John');
    expect(rows[0].property_ref).toBeUndefined();
  });

  it('ignores a blank property cell', () => {
    const rows = parseContactsCsv('phone,property_id\n+911234567890,');
    expect(rows[0].property_ref).toBeUndefined();
  });
});
