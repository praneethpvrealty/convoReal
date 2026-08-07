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
