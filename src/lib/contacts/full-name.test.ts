import { describe, it, expect } from 'vitest';
import { contactFullName } from './full-name';

describe('contactFullName', () => {
  it('joins first and second name', () => {
    expect(contactFullName({ name: 'Rahul', second_name: 'Sharma' })).toBe(
      'Rahul Sharma'
    );
  });

  it('falls back to whichever part exists', () => {
    expect(contactFullName({ name: 'Rahul', second_name: null })).toBe('Rahul');
    expect(contactFullName({ name: null, second_name: 'Sharma' })).toBe(
      'Sharma'
    );
    expect(contactFullName({ name: null, second_name: null })).toBe('');
  });

  it('trims stray whitespace', () => {
    expect(contactFullName({ name: ' Rahul ', second_name: '  ' })).toBe(
      'Rahul'
    );
  });
});
