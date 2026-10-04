import { describe, expect, it } from 'vitest';
import { parseCsvAudience } from './csv-audience';

describe('parseCsvAudience', () => {
  it('reads phone and optional name, normalising to E.164', () => {
    expect(parseCsvAudience('9876543210,Asha\n+91 98765 43211\n')).toEqual({
      contacts: [
        { phone: '+919876543210', name: 'Asha' },
        { phone: '+919876543211' },
      ],
      skipped: 0,
    });
  });

  it('skips a header row that is not a number without counting it', () => {
    const result = parseCsvAudience('Phone,Name\n09876543210,Ravi');
    expect(result.contacts).toEqual([{ phone: '+919876543210', name: 'Ravi' }]);
    expect(result.skipped).toBe(0);
  });

  it('counts invalid and duplicate numbers as skipped', () => {
    const result = parseCsvAudience(
      '9876543210\n12345\nnot a phone\n+919876543210\n"9876543212","Meera"'
    );
    expect(result.contacts).toEqual([
      { phone: '+919876543210' },
      { phone: '+919876543212', name: 'Meera' },
    ]);
    expect(result.skipped).toBe(3);
  });

  it('accepts CRLF line endings, semicolons and tabs, and ignores blank lines', () => {
    const result = parseCsvAudience(
      '9876543210;Asha\r\n\r\n9876543211\tRavi\r\n'
    );
    expect(result.contacts).toEqual([
      { phone: '+919876543210', name: 'Asha' },
      { phone: '+919876543211', name: 'Ravi' },
    ]);
  });

  it('keeps an international number with its own country code', () => {
    expect(parseCsvAudience('+44 7700 900123').contacts).toEqual([
      { phone: '+447700900123' },
    ]);
  });

  it('keeps a delimiter inside a quoted name', () => {
    const result = parseCsvAudience(
      '9876543210,"Patel, Asha"\n9876543211;"Rao; Kiran"\n9876543212\t"Shah\tMeera"\n9876543213,"Asha ""Ash"" Patel"'
    );
    expect(result.contacts.map((c) => c.name)).toEqual([
      'Patel, Asha',
      'Rao; Kiran',
      'Shah\tMeera',
      'Asha "Ash" Patel',
    ]);
    expect(result.skipped).toBe(0);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsvAudience('  \n ')).toEqual({ contacts: [], skipped: 0 });
  });
});
