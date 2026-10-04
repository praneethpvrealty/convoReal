import { describe, it, expect } from 'vitest';

import { MAX_CSV_CONTACTS } from '@shared/lib/broadcasts/csv-audience';

import {
  buildAudience,
  buildCsvAudience,
  defaultVariableMappings,
  draftChanged,
  mappingsComplete,
  previewBody,
  readCsvAudience,
  templateVariableKeys,
} from './broadcast-compose';

describe('templateVariableKeys', () => {
  it('finds placeholders in Meta numbering order', () => {
    expect(templateVariableKeys('Hi {{1}}, {{2}} is available')).toEqual([
      '1',
      '2',
    ]);
  });

  it('sorts numerically, not as strings', () => {
    // "10" must come after "2" — a lexical sort would put it first.
    expect(templateVariableKeys('{{2}} {{10}} {{1}}')).toEqual([
      '1',
      '2',
      '10',
    ]);
  });

  it('collapses a placeholder repeated in the body', () => {
    expect(templateVariableKeys('Hi {{1}}, thanks {{1}}')).toEqual(['1']);
  });

  it('returns nothing for a template with no placeholders', () => {
    expect(templateVariableKeys('Plain text')).toEqual([]);
    expect(templateVariableKeys(null)).toEqual([]);
  });
});

describe('defaultVariableMappings', () => {
  it('points every placeholder at the contact name', () => {
    expect(defaultVariableMappings(['1', '2'])).toEqual({
      '1': { type: 'field', value: 'name' },
      '2': { type: 'field', value: 'name' },
    });
  });
});

describe('previewBody', () => {
  const sample = { name: 'Rahul', company: 'Assetz' };

  it('substitutes field and static mappings', () => {
    const out = previewBody(
      'Hi {{1}}, from {{2}}',
      {
        '1': { type: 'field', value: 'name' },
        '2': { type: 'static', value: 'ConvoReal' },
      },
      sample
    );
    expect(out).toBe('Hi Rahul, from ConvoReal');
  });

  it('leaves the placeholder visible when the value would be empty', () => {
    // An unfilled slot must look unfilled — otherwise it sends as "{{2}}".
    const out = previewBody(
      'Hi {{1}}, from {{2}}',
      {
        '1': { type: 'field', value: 'name' },
        '2': { type: 'static', value: '   ' },
      },
      sample
    );
    expect(out).toBe('Hi Rahul, from {{2}}');
  });

  it('leaves the placeholder visible when the sample contact lacks the field', () => {
    const out = previewBody(
      'Hi {{1}}',
      { '1': { type: 'field', value: 'email' } },
      sample
    );
    expect(out).toBe('Hi {{1}}');
  });
});

describe('mappingsComplete', () => {
  it('requires every placeholder to resolve to something', () => {
    const keys = ['1', '2'];
    expect(
      mappingsComplete(keys, {
        '1': { type: 'field', value: 'name' },
        '2': { type: 'static', value: 'Hello' },
      })
    ).toBe(true);
    expect(
      mappingsComplete(keys, {
        '1': { type: 'field', value: 'name' },
        '2': { type: 'static', value: '  ' },
      })
    ).toBe(false);
    expect(
      mappingsComplete(keys, { '1': { type: 'field', value: 'name' } })
    ).toBe(false);
  });
});

describe('buildAudience', () => {
  it('omits tagIds for an all-contacts audience', () => {
    expect(buildAudience('all', ['t1'], [])).toEqual({ type: 'all' });
  });

  it('carries tagIds when targeting tags', () => {
    expect(buildAudience('tags', ['t1', 't2'], [])).toEqual({
      type: 'tags',
      tagIds: ['t1', 't2'],
    });
  });

  it('carries exclusions for either audience type', () => {
    expect(buildAudience('all', [], ['opt-out'])).toEqual({
      type: 'all',
      excludeTagIds: ['opt-out'],
    });
  });
});

describe('readCsvAudience', () => {
  it('counts valid and skipped numbers in a pasted list', () => {
    const draft = readCsvAudience(
      'Phone,Name\n9876543210, Asha\n12345\n+91 98765 43210\n+44 7700 900123'
    );
    expect(draft).toEqual({
      contacts: [
        { phone: '+919876543210', name: 'Asha' },
        { phone: '+447700900123' },
      ],
      skipped: 2,
      overCap: false,
    });
  });

  it('flags a list longer than one broadcast can hold', () => {
    const lines = Array.from(
      { length: MAX_CSV_CONTACTS + 1 },
      (_, i) => `9${String(i).padStart(9, '0')}`
    );
    const draft = readCsvAudience(lines.join('\n'));
    expect(draft.contacts).toHaveLength(MAX_CSV_CONTACTS + 1);
    expect(draft.overCap).toBe(true);
  });
});

describe('buildCsvAudience', () => {
  it('sends the parsed numbers with any exclusions', () => {
    expect(
      buildCsvAudience(readCsvAudience('9876543210,Asha\n9876543211'), [
        'opt-out',
      ])
    ).toEqual({
      type: 'csv',
      csvContacts: [
        { phone: '+919876543210', name: 'Asha' },
        { phone: '+919876543211' },
      ],
      excludeTagIds: ['opt-out'],
    });
  });

  it('omits exclusions when none are picked', () => {
    expect(buildCsvAudience(readCsvAudience('9876543210'), [])).toEqual({
      type: 'csv',
      csvContacts: [{ phone: '+919876543210' }],
    });
  });

  it('gives no audience for an empty or unusable paste', () => {
    expect(buildCsvAudience(readCsvAudience(''), [])).toBeNull();
    expect(buildCsvAudience(readCsvAudience('  \n\n'), [])).toBeNull();
    expect(
      buildCsvAudience(readCsvAudience('12345\nnot a phone'), [])
    ).toBeNull();
  });

  it('gives no audience for a list over the cap', () => {
    const lines = Array.from(
      { length: MAX_CSV_CONTACTS + 1 },
      (_, i) => `9${String(i).padStart(9, '0')}`
    );
    expect(buildCsvAudience(readCsvAudience(lines.join('\n')), [])).toBeNull();
  });

  it('accepts a list exactly at the cap', () => {
    const lines = Array.from(
      { length: MAX_CSV_CONTACTS },
      (_, i) => `9${String(i).padStart(9, '0')}`
    );
    const audience = buildCsvAudience(readCsvAudience(lines.join('\n')), []);
    expect(audience?.csvContacts).toHaveLength(MAX_CSV_CONTACTS);
  });
});

describe('readCsvAudience country code', () => {
  it('dials a local number under the configured country code', () => {
    expect(readCsvAudience('7700900123', '44').contacts).toEqual([
      { phone: '+447700900123' },
    ]);
  });

  it('keeps an explicitly international number as written', () => {
    expect(readCsvAudience('+919876543210', '44').contacts).toEqual([
      { phone: '+919876543210' },
    ]);
  });
});

describe('draftChanged', () => {
  const template = { id: 't1' };
  const audience = buildAudience('all', [], []);
  const variables = defaultVariableMappings(['1']);
  const draft = { name: 'Diwali', template, audience, variables };

  it('is false when nothing was replaced', () => {
    expect(draftChanged(draft, { ...draft })).toBe(false);
  });

  it('catches a different template', () => {
    expect(draftChanged(draft, { ...draft, template: { id: 't2' } })).toBe(
      true
    );
  });

  it('catches an edited variable', () => {
    expect(
      draftChanged(draft, {
        ...draft,
        variables: { 1: { type: 'static', value: 'Asha' } },
      })
    ).toBe(true);
  });

  it('catches a renamed broadcast and a new audience', () => {
    expect(draftChanged(draft, { ...draft, name: 'Holi' })).toBe(true);
    expect(
      draftChanged(draft, { ...draft, audience: buildAudience('all', [], []) })
    ).toBe(true);
  });
});
