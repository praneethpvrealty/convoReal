import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_RECIPIENT_COUNT,
  defaultShareRecipients,
  hasRealName,
} from './share-recipients';

function contact(
  id: string,
  fields: {
    name?: string | null;
    phone?: string | null;
    last_contacted_at?: string | null;
    updated_at?: string | null;
  } = {}
) {
  return {
    id,
    name: fields.name ?? null,
    phone: fields.phone ?? '919800000000',
    last_contacted_at: fields.last_contacted_at ?? null,
    updated_at: fields.updated_at ?? null,
  };
}

describe('[PRP-045] defaultShareRecipients', () => {
  it('puts the most recently contacted first', () => {
    const rows = [
      contact('old', {
        name: 'Abbas',
        last_contacted_at: '2026-09-01T00:00:00Z',
      }),
      contact('new', {
        name: 'Zara',
        last_contacted_at: '2026-10-07T00:00:00Z',
      }),
      contact('mid', {
        name: 'Meera',
        last_contacted_at: '2026-09-20T00:00:00Z',
      }),
    ];
    expect(defaultShareRecipients(rows).map((c) => c.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('ignores edits, so a never-contacted contact is not recent', () => {
    const rows = [
      contact('edited', { name: 'Zed', updated_at: '2026-10-08T00:00:00Z' }),
      contact('contacted', {
        name: 'Abbas',
        last_contacted_at: '2026-01-01T00:00:00Z',
      }),
    ];
    expect(defaultShareRecipients(rows).map((c) => c.id)).toEqual([
      'contacted',
      'edited',
    ]);
  });

  it('ranks a named contact above a phone-only one with no activity', () => {
    const rows = [
      contact('phone', { name: '+919986551010', phone: '+919986551010' }),
      contact('blank', { name: null }),
      contact('named', { name: 'Aakriti Dimensions' }),
    ];
    expect(defaultShareRecipients(rows)[0].id).toBe('named');
  });

  it('caps the default list', () => {
    const rows = Array.from({ length: 30 }, (_, i) => contact(`c${i}`));
    expect(defaultShareRecipients(rows)).toHaveLength(
      DEFAULT_SHARE_RECIPIENT_COUNT
    );
  });

  it('does not reorder the caller array', () => {
    const rows = [contact('a', { name: 'A' }), contact('b', { name: 'B' })];
    defaultShareRecipients(rows);
    expect(rows.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('[PRP-045] hasRealName', () => {
  it('treats a name that is only the phone number as no name', () => {
    expect(
      hasRealName({ name: '+91 99865 51010', phone: '919986551010' })
    ).toBe(false);
    expect(hasRealName({ name: 'Abbas', phone: '919916042446' })).toBe(true);
    expect(hasRealName({ name: '  ', phone: '919916042446' })).toBe(false);
  });

  it('matches a local or trunk-prefixed number against the stored one', () => {
    expect(hasRealName({ name: '9986551010', phone: '919986551010' })).toBe(
      false
    );
    expect(hasRealName({ name: '09986551010', phone: '+919986551010' })).toBe(
      false
    );
    expect(hasRealName({ name: '9986551010', phone: '919700606010' })).toBe(
      true
    );
    expect(hasRealName({ name: 'Flat 51010', phone: '919986551010' })).toBe(
      true
    );
  });
});
