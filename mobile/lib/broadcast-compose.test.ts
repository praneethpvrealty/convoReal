import { describe, it, expect } from 'vitest';

import {
  buildAudience,
  defaultVariableMappings,
  mappingsComplete,
  previewBody,
  templateVariableKeys,
} from './broadcast-compose';

describe('templateVariableKeys', () => {
  it('finds placeholders in Meta numbering order', () => {
    expect(templateVariableKeys('Hi {{1}}, {{2}} is available')).toEqual(['1', '2']);
  });

  it('sorts numerically, not as strings', () => {
    // "10" must come after "2" — a lexical sort would put it first.
    expect(templateVariableKeys('{{2}} {{10}} {{1}}')).toEqual(['1', '2', '10']);
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
      { '1': { type: 'field', value: 'name' }, '2': { type: 'static', value: 'ConvoReal' } },
      sample
    );
    expect(out).toBe('Hi Rahul, from ConvoReal');
  });

  it('leaves the placeholder visible when the value would be empty', () => {
    // An unfilled slot must look unfilled — otherwise it sends as "{{2}}".
    const out = previewBody(
      'Hi {{1}}, from {{2}}',
      { '1': { type: 'field', value: 'name' }, '2': { type: 'static', value: '   ' } },
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
    expect(mappingsComplete(keys, { '1': { type: 'field', value: 'name' } })).toBe(false);
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
