import { describe, expect, it } from 'vitest';

import { parseUpdateIntent } from './update-intent';

describe('parseUpdateIntent — property', () => {
  it('captures a property code with the "property" keyword', () => {
    expect(parseUpdateIntent('update property PROP-1018')).toEqual({
      type: 'property',
      identifier: 'PROP-1018',
    });
  });

  it('captures a property code without the "property" keyword', () => {
    expect(parseUpdateIntent('update PROP1018')).toEqual({
      type: 'property',
      identifier: 'PROP1018',
    });
  });

  it('normalizes the captured identifier to upper case', () => {
    expect(parseUpdateIntent('update prop-42')?.identifier).toBe('PROP-42');
  });

  it('returns a bare property intent when no code is given', () => {
    expect(parseUpdateIntent('update property')).toEqual({ type: 'property' });
  });
});

describe('parseUpdateIntent — contact', () => {
  it('recognizes an explicit contact update', () => {
    expect(parseUpdateIntent('update contact')).toEqual({ type: 'contact' });
  });

  it('defaults a bare "update" to the current contact', () => {
    expect(parseUpdateIntent('update')).toEqual({ type: 'contact' });
    expect(parseUpdateIntent('  UPDATE  ')).toEqual({ type: 'contact' });
  });
});

describe('parseUpdateIntent — non-matches', () => {
  it.each([
    'hello there',
    'please send me an update on the flat', // "update" mid-sentence, no verb form
    'updated the price yesterday',
    '',
  ])('returns null for %j', (text) => {
    expect(parseUpdateIntent(text)).toBeNull();
  });
});
