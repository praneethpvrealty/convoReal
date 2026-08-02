import { describe, it, expect } from 'vitest';

import { contactFullName } from './contact-name';

describe('contactFullName', () => {
  it('joins the first and second name', () => {
    expect(contactFullName({ name: 'Rahul', second_name: 'Sharma' })).toBe('Rahul Sharma');
  });

  it('falls back to whichever part is present', () => {
    expect(contactFullName({ name: 'Rahul', second_name: null })).toBe('Rahul');
    expect(contactFullName({ name: null, second_name: 'Sharma' })).toBe('Sharma');
  });

  it('ignores blank and whitespace-only parts', () => {
    expect(contactFullName({ name: 'Rahul', second_name: '   ' })).toBe('Rahul');
    expect(contactFullName({ name: '  Rahul  ', second_name: ' Sharma ' })).toBe('Rahul Sharma');
    expect(contactFullName({})).toBe('');
  });
});
