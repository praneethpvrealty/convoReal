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

  it('needs a phone or an email column, and skips rows carrying neither', () => {
    expect(parseContactsCsv('name,company\nJohn,Acme')).toEqual([]);
    const rows = parseContactsCsv(
      'phone,name\n,No Phone\n+911234567890,Has Phone'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Has Phone');
  });

  it('imports an email-only file — a builder list with no numbers', () => {
    const rows = parseContactsCsv(
      'name,email,company\nBrigade Lands,sales@brigade.com,Brigade Group'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBeUndefined();
    expect(rows[0].email).toBe('sales@brigade.com');
    expect(rows[0].company).toBe('Brigade Group');
  });

  it('keeps the numbered rows of a mixed file and the mailbox-only ones', () => {
    const rows = parseContactsCsv(
      'phone,name,email\n+911234567890,Has Phone,a@b.com\n,Mailbox Only,desk@builder.com\n,Nothing,'
    );
    expect(rows.map((r) => r.name)).toEqual(['Has Phone', 'Mailbox Only']);
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

describe('parseContactsCsv — portal CRM exports', () => {
  // The shape a MagicBricks / Housing / 99acres export actually has:
  // number split across two columns, none of the headers named the way
  // the Engine names them, and the same lead repeated per enquiry.
  const portalCsv = [
    'Notes,Customer Name,Country Code,Contact Number,Customer Email,Location,Budget,Property Id,Contact Message Details',
    ',Tulajaram,91,9876543210,t@example.com,Kumaraswamy Layout,5500000,75995649,"Looking for 2 BHK for Sale in Kumaraswamy Layout"',
    ',Asha,91,9876543211,a@example.com,Whitefield,12000000,74928739,"Looking for a Residential Plot in Whitefield"',
  ].join('\r\n');

  it('reads a portal export without any reshaping', () => {
    const rows = parseContactsCsv(portalCsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      phone: '+919876543210',
      name: 'Tulajaram',
      email: 't@example.com',
      areas_of_interest: 'Kumaraswamy Layout',
      max_budget: 5500000,
      property_ref: '75995649',
    });
    expect(rows[0].notes).toContain('2 BHK');
  });

  it('joins Country Code onto Contact Number exactly once', () => {
    const already = parseContactsCsv(
      'Country Code,Contact Number\r\n91,919876543210'
    );
    expect(already[0].phone).toBe('+919876543210');
    const plus = parseContactsCsv('Country Code,Phone\r\n91,+919876543210');
    expect(plus[0].phone).toBe('+919876543210');
    const intl = parseContactsCsv(
      'Country Code,Contact Number\r\n971,501234567'
    );
    expect(intl[0].phone).toBe('+971501234567');
  });

  it('survives the UTF-8 BOM Excel writes, which would hide the first header', () => {
    const rows = parseContactsCsv('﻿Phone,Customer Name\r\n+919876543210,Asha');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Asha');
  });

  it('keeps one row per number and lets later rows fill blanks', () => {
    const dupes = [
      'Contact Number,Customer Name,Customer Email,Location',
      '9876543210,Asha,,Whitefield',
      '9876543210,,asha@example.com,HSR',
      '9876543211,Ravi,,Hebbal',
    ].join('\n');
    const rows = parseContactsCsv(dupes);
    expect(rows).toHaveLength(2);
    // First occurrence wins on conflict, but its blank email is filled.
    expect(rows[0].name).toBe('Asha');
    expect(rows[0].areas_of_interest).toBe('Whitefield');
    expect(rows[0].email).toBe('asha@example.com');
  });

  it('still prefers the canonical header when a file carries both', () => {
    const rows = parseContactsCsv(
      'phone,contact number,name,customer name\n+919999999999,+918888888888,Real,Portal'
    );
    expect(rows[0].phone).toBe('+919999999999');
    expect(rows[0].name).toBe('Real');
  });
});
