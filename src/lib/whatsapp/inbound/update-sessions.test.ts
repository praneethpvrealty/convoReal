import { describe, expect, it } from 'vitest';

import { parseUpdateIntent } from './update-sessions';

describe('parseUpdateIntent', () => {
  it('reads a property code with or without the word property', () => {
    expect(parseUpdateIntent('Update property PROP-1018')).toEqual({
      type: 'property',
      identifier: 'PROP-1018',
    });
    expect(parseUpdateIntent('update prop1018 please')).toEqual({
      type: 'property',
      identifier: 'PROP1018',
    });
  });

  it('falls back to the bare noun when no code is given', () => {
    expect(parseUpdateIntent('update property')).toEqual({ type: 'property' });
    expect(parseUpdateIntent('Update contact')).toEqual({ type: 'contact' });
    expect(parseUpdateIntent(' update ')).toEqual({ type: 'contact' });
  });

  it('ignores messages that only mention an update in passing', () => {
    expect(parseUpdateIntent('any update on the flat?')).toBeNull();
    expect(parseUpdateIntent('updated my number')).toBeNull();
    expect(parseUpdateIntent('')).toBeNull();
  });
});
