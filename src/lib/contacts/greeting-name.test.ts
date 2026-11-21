import { describe, expect, it } from 'vitest';
import { greetingName } from './greeting-name';

describe('[INB-051] greetingName', () => {
  it('keeps the name after a title instead of greeting the title alone', () => {
    expect(greetingName('Dr Subbaiha')).toBe('Dr Subbaiha');
    expect(greetingName('Dr. Anil Kumar')).toBe('Dr. Anil');
    expect(greetingName('mrs Lakshmi Rao')).toBe('mrs Lakshmi');
  });

  it('returns the first name when there is no title', () => {
    expect(greetingName('Santhosh Otageri')).toBe('Santhosh');
    expect(greetingName('  Drishti  Shah ')).toBe('Drishti');
  });

  it('returns what it has for a lone title or an empty name', () => {
    expect(greetingName('Dr')).toBe('Dr');
    expect(greetingName('')).toBe('');
    expect(greetingName(null)).toBe('');
  });
});
