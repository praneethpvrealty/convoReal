import { describe, expect, it } from 'vitest';
import {
  applyContactSalutation,
  applySalutationToTemplateParams,
  respectfulContactName,
} from './salutation';

describe('contact salutations', () => {
  it('adds the explicitly selected title', () => {
    expect(respectfulContactName('Anand', 'Mr.')).toBe('Mr. Anand');
    expect(respectfulContactName('Anita', 'Mrs.')).toBe('Mrs. Anita');
  });

  it('does not duplicate an existing title', () => {
    expect(respectfulContactName('Mr Anand', 'Mr.')).toBe('Mr. Anand');
    expect(respectfulContactName('Mrs. Anita', null)).toBe('Mrs. Anita');
  });

  it('personalizes a leading client greeting', () => {
    expect(applyContactSalutation('Hi Anand, here are the details.', 'Anand', 'Mr.')).toBe(
      'Hi Mr. Anand, here are the details.'
    );
    expect(applyContactSalutation('Hello Anand!', 'Anand Kumar', 'Mr.')).toBe(
      'Hello Mr. Anand!'
    );
  });

  it('personalizes contact-name template parameters', () => {
    expect(applySalutationToTemplateParams(['Anand', 'PROP-1'], 'Anand', 'Mr.')).toEqual([
      'Mr. Anand',
      'PROP-1',
    ]);
  });
});
