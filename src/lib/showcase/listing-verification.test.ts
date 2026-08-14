import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateSubmissionCode,
  extractSubmissionCode,
} from '@/lib/showcase/listing-verification';

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
      extractSubmissionCode(
        'Hi, I want to list my property. My code is LIST-A7K2 thanks'
      )
    ).toBe('LIST-A7K2');
  });

  it('uppercases a lowercased code', () => {
    expect(extractSubmissionCode('code: list-a7k2')).toBe('LIST-A7K2');
  });

  it('returns null when no code is present', () => {
    expect(
      extractSubmissionCode('Is this property still available?')
    ).toBeNull();
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

// Suraj Group's first contact was two PDF decks — the way commercial
// landlords actually share inventory — and the funnel had nowhere to
// put them. These pin the wiring that closes that: the deck itself is
// parsed on verification, its photos become the gallery, and the
// brochure stays attached to the property.
describe('the verification parses a submitted brochure', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/showcase/listing-verification.ts'),
    'utf8'
  );

  it('feeds the PDF bytes to the same parser the owner chatbot uses', () => {
    expect(source).toMatch(
      /parseListingFromImageOrText\(\s*claimed\.raw_text \|\| '',\s*deckBuffer,\s*'application\/pdf'\s*\)/
    );
  });

  it('harvests the deck photos into the listing gallery', () => {
    expect(source).toContain('extractImagesFromPdf(deckBuffer)');
    expect(source).toContain(
      '[...submittedImages, ...deckImages].slice(0, 15)'
    );
  });

  it('keeps the brochure attached to the created property', () => {
    expect(source).toContain('documents: submittedDocs,');
  });

  it('degrades to the text-only parse when the deck cannot be fetched', () => {
    expect(source).toContain(
      'await parseListingFromImageOrText(claimed.raw_text);'
    );
  });
});

describe('the submit route accepts a brochure-only submission', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/api/public/list-property/route.ts'),
    'utf8'
  );

  it('waives the text floor when a deck is attached — "PFA our decks" is a complete submission', () => {
    expect(source).toContain(
      'rawText.length < MIN_TEXT_LEN && documents.length === 0'
    );
  });

  it('only trusts PDFs on our own storage host', () => {
    const block = source.slice(
      source.indexOf('const documents'),
      source.indexOf('const documents') + 600
    );
    expect(block).toContain("u.toLowerCase().includes('.pdf')");
    expect(block).toContain('storageHostForDocs');
  });
});
