import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIENCE_CONTACT_IDS,
  MAX_CSV_CONTACTS,
  parseAudience,
} from './audience';

describe('parseAudience', () => {
  it('refuses a missing audience instead of defaulting to everyone', () => {
    expect(parseAudience(undefined)).toEqual({ error: 'Choose an audience' });
    expect(parseAudience({})).toEqual({ error: 'Choose an audience' });
  });

  it('keeps exclusions on every audience type', () => {
    expect(
      parseAudience({ type: 'all', excludeTagIds: ['t1', 't1', ''] })
    ).toEqual({ audience: { type: 'all', excludeTagIds: ['t1'] } });
    expect(
      parseAudience({ type: 'tags', tagIds: ['t2'], excludeTagIds: ['t1'] })
    ).toEqual({
      audience: { type: 'tags', tagIds: ['t2'], excludeTagIds: ['t1'] },
    });
  });

  it('requires tags, contacts and a complete custom-field filter', () => {
    expect(parseAudience({ type: 'tags', tagIds: [] })).toHaveProperty('error');
    expect(parseAudience({ type: 'contacts' })).toHaveProperty('error');
    expect(
      parseAudience({
        type: 'custom_field',
        customField: { fieldId: 'f1', operator: 'is', value: '' },
      })
    ).toHaveProperty('error');
    expect(
      parseAudience({
        type: 'custom_field',
        customField: { fieldId: 'f1', operator: 'drop', value: 'x' },
      })
    ).toHaveProperty('error');
    expect(
      parseAudience({
        type: 'custom_field',
        customField: { fieldId: 'f1', operator: 'contains', value: 'Pune' },
      })
    ).toEqual({
      audience: {
        type: 'custom_field',
        customField: { fieldId: 'f1', operator: 'contains', value: 'Pune' },
      },
    });
  });

  it('bounds selected contacts and CSV rows', () => {
    const ids = Array.from(
      { length: MAX_AUDIENCE_CONTACT_IDS + 1 },
      (_, i) => `c${i}`
    );
    expect(parseAudience({ type: 'contacts', contactIds: ids })).toHaveProperty(
      'error'
    );
    const rows = Array.from({ length: MAX_CSV_CONTACTS + 1 }, (_, i) => ({
      phone: `+9198765${String(i).padStart(5, '0')}`,
    }));
    expect(parseAudience({ type: 'csv', csvContacts: rows })).toHaveProperty(
      'error'
    );
  });

  it('keeps only CSV rows that carry a phone', () => {
    expect(
      parseAudience({
        type: 'csv',
        csvContacts: [
          { phone: ' +919876543210 ', name: ' Asha ' },
          { phone: '' },
          { name: 'no phone' },
          null,
        ],
      })
    ).toEqual({
      audience: {
        type: 'csv',
        csvContacts: [{ phone: '+919876543210', name: 'Asha' }],
      },
    });
  });
});
