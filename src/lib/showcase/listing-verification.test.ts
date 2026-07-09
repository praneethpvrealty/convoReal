import { describe, it, expect } from 'vitest';
import { generateSubmissionCode, extractSubmissionCode } from '@/lib/showcase/listing-verification';

describe('generateSubmissionCode', () => {
  it('produces a LIST- prefixed 4-char code from the unambiguous alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateSubmissionCode();
      expect(code).toMatch(/^LIST-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
      // No ambiguous characters.
      expect(code.slice(5)).not.toMatch(/[0O1IL]/);
    }
  });
});

describe('extractSubmissionCode', () => {
  it('returns null for empty/nullish input', () => {
    expect(extractSubmissionCode('')).toBeNull();
    expect(extractSubmissionCode(null)).toBeNull();
    expect(extractSubmissionCode(undefined)).toBeNull();
  });

  it('extracts a code embedded in a friendly message', () => {
    expect(
      extractSubmissionCode('Hi, I want to list my property. My code is LIST-A7K2 thanks'),
    ).toBe('LIST-A7K2');
  });

  it('uppercases a lowercased code', () => {
    expect(extractSubmissionCode('code: list-a7k2')).toBe('LIST-A7K2');
  });

  it('returns null when no code is present', () => {
    expect(extractSubmissionCode('Is this property still available?')).toBeNull();
  });

  it('does not match codes using ambiguous letters outside the alphabet', () => {
    // O, I, L, 0, 1 are not in the alphabet, so these are not valid codes.
    expect(extractSubmissionCode('LIST-O0I1')).toBeNull();
  });

  it('matches a round-tripped generated code', () => {
    const code = generateSubmissionCode();
    expect(extractSubmissionCode(`please use ${code} to verify`)).toBe(code);
  });
});
