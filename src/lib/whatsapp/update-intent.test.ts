import { describe, it, expect } from 'vitest';
import { parseUpdateIntent } from './update-intent';

describe('parseUpdateIntent', () => {
  it('parses update with property code', () => {
    expect(parseUpdateIntent('update property PROP-1018')).toEqual({ type: 'property', identifier: 'PROP-1018' });
    expect(parseUpdateIntent('update prop-1018')).toEqual({ type: 'property', identifier: 'PROP-1018' });
  });

  it('parses update with separator between property and code', () => {
    expect(parseUpdateIntent('Update property - prop-1050')).toEqual({ type: 'property', identifier: 'PROP-1050' });
    expect(parseUpdateIntent('update property: PROP-1050')).toEqual({ type: 'property', identifier: 'PROP-1050' });
    expect(parseUpdateIntent('update listing - prop 1050')).toEqual({ type: 'property', identifier: 'PROP-1050' });
    expect(parseUpdateIntent('edit property PROP 1050')).toEqual({ type: 'property', identifier: 'PROP-1050' });
  });

  it('normalizes spaced or unhyphenated codes', () => {
    expect(parseUpdateIntent('update prop 1022')).toEqual({ type: 'property', identifier: 'PROP-1022' });
    expect(parseUpdateIntent('update PROP - 1022')).toEqual({ type: 'property', identifier: 'PROP-1022' });
  });

  it('parses generic property update without a code', () => {
    expect(parseUpdateIntent('update property')).toEqual({ type: 'property' });
    expect(parseUpdateIntent('edit listing')).toEqual({ type: 'property' });
  });

  it('parses contact update and bare update', () => {
    expect(parseUpdateIntent('update contact')).toEqual({ type: 'contact' });
    expect(parseUpdateIntent('update')).toEqual({ type: 'contact' });
  });

  it('returns null for listing-like and unrelated texts', () => {
    expect(parseUpdateIntent('3 BHK flat in HSR for sale at 1.5 cr')).toBeNull();
    expect(parseUpdateIntent('newly updated property in Whitefield')).toBeNull();
    expect(parseUpdateIntent('price is 50 lakhs')).toBeNull();
    expect(parseUpdateIntent('')).toBeNull();
  });
});
