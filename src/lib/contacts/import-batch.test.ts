import { describe, it, expect } from 'vitest';
import {
  prepareImportRows,
  distinctTagNames,
  dedupeTags,
  type ImportRow,
} from './import-batch';

type ResolveProperty = (ref: string) => string | null;

const noProperties: ResolveProperty = () => null;

function run(rows: ImportRow[], resolve: ResolveProperty = noProperties) {
  return prepareImportRows(rows, resolve);
}

describe('prepareImportRows', () => {
  it('keeps one record per number, in the order the file lists them', () => {
    const { prepared, merged } = run([
      { phone: '919876543210', name: 'Asha' },
      { phone: '919000000001', name: 'Ravi' },
      { phone: '+91 98765 43210', email: 'asha@example.com' },
    ]);

    expect(prepared.map((p) => p.key)).toEqual([
      '919876543210',
      '919000000001',
    ]);
    expect(merged).toBe(1);
    expect(prepared[0].fields.name).toBe('Asha');
    // The later row filled a blank rather than being dropped.
    expect(prepared[0].fields.email).toBe('asha@example.com');
  });

  it('stores the number as uploaded but matches on digits', () => {
    const { prepared } = run([{ phone: ' +91 98765-43210 ' }]);
    expect(prepared[0].phone).toBe('+91 98765-43210');
    expect(prepared[0].key).toBe('919876543210');
  });

  it('counts rows with neither phone nor email as invalid', () => {
    const { prepared, invalid } = run([
      { phone: '', name: 'Nobody' },
      { name: 'Also nobody' },
      { phone: '919876543210' },
    ]);
    expect(invalid).toBe(2);
    expect(prepared).toHaveLength(1);
  });

  it('keeps an email-only row, keyed on the address', () => {
    const { prepared, invalid, merged } = run([
      { email: 'Sales@Brigade.com', name: 'Brigade Lands' },
      { email: 'sales@brigade.com', company: 'Brigade Group' },
      { phone: '919876543210', email: 'sales@brigade.com' },
    ]);

    expect(invalid).toBe(0);
    expect(merged).toBe(1);
    // The mailbox row and the row carrying a number are different
    // identities: the number is the one that can be messaged.
    expect(prepared.map((p) => p.key)).toEqual([
      'email:sales@brigade.com',
      '919876543210',
    ]);
    expect(prepared[0].phone).toBeNull();
    expect(prepared[0].fields.company).toBe('Brigade Group');
  });

  it('does not collapse unrelated junk numbers into one record', () => {
    // Both strip to no digits; keying on the raw text keeps them apart.
    const { prepared } = run([{ phone: 'n/a' }, { phone: 'unknown' }]);
    expect(prepared).toHaveLength(2);
  });

  it('never lets a later duplicate overwrite what an earlier row set', () => {
    const { prepared } = run([
      { phone: '919876543210', name: 'Asha Kumar', max_budget: 20000000 },
      { phone: '919876543210', name: 'Asha', max_budget: 5500000 },
    ]);
    expect(prepared[0].fields.name).toBe('Asha Kumar');
    expect(prepared[0].fields.max_budget).toBe(20000000);
  });

  it('takes the freshest enquired property across duplicates', () => {
    const { prepared } = run(
      [
        { phone: '919876543210', property_ref: 'PROP-1' },
        { phone: '919876543210', property_ref: 'PROP-2' },
      ],
      (ref) => (ref === 'PROP-1' ? 'id-1' : 'id-2')
    );
    expect(prepared[0].fields.last_inquired_property_id).toBe('id-2');
  });

  it('leaves the lead unlinked when the reference matches no listing', () => {
    // The portal Property Id case: the column is present but inventory
    // has never heard of it.
    const { prepared } = run([
      { phone: '919876543210', property_ref: 'MB-99999' },
    ]);
    expect(prepared[0].fields.last_inquired_property_id).toBeNull();
  });

  it('splits areas and tags, dropping empties', () => {
    const { prepared } = run([
      {
        phone: '919876543210',
        areas_of_interest: 'Whitefield, , HSR ',
        tags: 'MagicBricks, ,2024',
      },
    ]);
    expect(prepared[0].fields.areas_of_interest).toEqual(['Whitefield', 'HSR']);
    expect(prepared[0].tags).toEqual(['MagicBricks', '2024']);
  });

  it('keeps every note a duplicated number carried', () => {
    const { prepared } = run([
      { phone: '919876543210', notes: 'Wants 3BHK' },
      { phone: '919876543210', notes: '  ' },
      { phone: '919876543210', notes: 'Budget went up' },
    ]);
    expect(prepared[0].notes).toEqual(['Wants 3BHK', 'Budget went up']);
  });

  it('does not repeat a tag a duplicated number already carried', () => {
    // contact_tags is UNIQUE(contact_id, tag_id); one conflicting pair
    // would fail the whole batched insert.
    const { prepared } = run([
      { phone: '919876543210', tags: 'MagicBricks' },
      { phone: '919876543210', tags: 'magicbricks, 2024' },
    ]);
    expect(prepared[0].tags).toEqual(['MagicBricks', '2024']);
  });

  it('gives every prepared record a distinct phone key', () => {
    // The inquiry upsert relies on this: one contact per key means the
    // (contact_id, property_id) pairs cannot collide in one statement.
    const { prepared } = run([
      { phone: '919876543210' },
      { phone: '+919876543210' },
      { phone: '91 98765 43210' },
      { phone: '919000000001' },
    ]);
    expect(new Set(prepared.map((p) => p.key)).size).toBe(prepared.length);
    expect(prepared).toHaveLength(2);
  });
});

describe('distinctTagNames', () => {
  it('collapses the whole upload to the tags actually worth looking up', () => {
    // A re-engagement batch tags every row the same way, so this is what
    // turns one lookup per row into one lookup per tag.
    const { prepared } = run(
      Array.from({ length: 50 }, (_, i) => ({
        phone: `9190000000${String(i).padStart(2, '0')}`,
        tags: 'MagicBricks, 2024 Leads',
      }))
    );
    expect(distinctTagNames(prepared)).toEqual(['MagicBricks', '2024 Leads']);
  });

  it('is case-insensitive across rows', () => {
    const { prepared } = run([
      { phone: '919876543210', tags: 'Hot Lead' },
      { phone: '919000000001', tags: 'hot lead' },
    ]);
    expect(distinctTagNames(prepared)).toEqual(['Hot Lead']);
  });
});

describe('dedupeTags', () => {
  it('keeps the first spelling', () => {
    expect(dedupeTags(['Hot', 'HOT', 'hot', 'Cold'])).toEqual(['Hot', 'Cold']);
  });
});
