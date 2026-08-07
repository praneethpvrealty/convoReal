import { describe, it, expect } from 'vitest';
import { classifyPropertyRef } from './property-reference';

describe('classifyPropertyRef', () => {
  it('recognises a property UUID', () => {
    expect(classifyPropertyRef('4f1247de-269c-47c2-8974-36ef8f77f77d')).toEqual(
      {
        kind: 'id',
        value: '4f1247de-269c-47c2-8974-36ef8f77f77d',
      }
    );
  });

  it('recognises a PROP- code and normalises its case', () => {
    expect(classifyPropertyRef('prop-1018')).toEqual({
      kind: 'code',
      value: 'PROP-1018',
    });
  });

  it('treats a portal listing id and a title alike as opaque', () => {
    // Indistinguishable by shape, so the resolver tries both rather
    // than guessing which one the export meant.
    expect(classifyPropertyRef('76543210')).toEqual({
      kind: 'opaque',
      value: '76543210',
    });
    expect(classifyPropertyRef('Prestige Lakeside Habitat')).toEqual({
      kind: 'opaque',
      value: 'Prestige Lakeside Habitat',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(classifyPropertyRef('  PROP-1018  ')?.value).toBe('PROP-1018');
  });

  it('returns null for a blank or missing reference', () => {
    expect(classifyPropertyRef('')).toBeNull();
    expect(classifyPropertyRef('   ')).toBeNull();
    expect(classifyPropertyRef(null)).toBeNull();
    expect(classifyPropertyRef(undefined)).toBeNull();
  });

  it('does not mistake a near-UUID for an id', () => {
    expect(classifyPropertyRef('4f1247de-269c-47c2-8974')?.kind).toBe('opaque');
  });
});
