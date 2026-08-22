import { describe, expect, it } from 'vitest';

import { parseClientNameAnswer } from './client-answer';

describe('parseClientNameAnswer', () => {
  it('reads the name out of the sentence an agent actually types', () => {
    expect(
      parseClientNameAnswer('Natarajan is already a contact in our application')
    ).toBe('Natarajan');
    expect(parseClientNameAnswer("it's Natarajan")).toBe('Natarajan');
    expect(parseClientNameAnswer('This is Suresh Kumar')).toBe('Suresh Kumar');
    expect(parseClientNameAnswer('his name is Ravi Shankar')).toBe(
      'Ravi Shankar'
    );
  });

  it('accepts a bare name', () => {
    expect(parseClientNameAnswer('Natarajan')).toBe('Natarajan');
    expect(parseClientNameAnswer('Vasundhara Rao')).toBe('Vasundhara Rao');
  });

  it('refuses anything that is not naming a person', () => {
    expect(parseClientNameAnswer('PROP-1138')).toBeNull();
    expect(
      parseClientNameAnswer('https://convoreal.com/property/x')
    ).toBeNull();
    expect(parseClientNameAnswer('ok')).toBeNull();
    expect(parseClientNameAnswer('')).toBeNull();
    expect(parseClientNameAnswer(null)).toBeNull();
    expect(
      parseClientNameAnswer(
        'Send the Sarjapur brochure to everyone who enquired last week and then set a reminder'
      )
    ).toBeNull();
  });

  it('refuses a run of words too long to be a name', () => {
    expect(parseClientNameAnswer('Ravi Kumar Shankar Reddy Prasad')).toBeNull();
  });
});
