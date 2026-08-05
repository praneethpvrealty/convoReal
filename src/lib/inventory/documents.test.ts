import { describe, it, expect } from 'vitest';
import { parsePropertyDocuments, documentDisplayName } from './documents';

describe('parsePropertyDocuments', () => {
  it('returns an empty list for missing or non-array input', () => {
    expect(parsePropertyDocuments(null)).toEqual([]);
    expect(parsePropertyDocuments(undefined)).toEqual([]);
  });

  it('reads a bare storage path', () => {
    const [doc] = parsePropertyDocuments(['property-documents/a1/deed.pdf']);
    expect(doc.url).toContain('property-documents/a1/deed.pdf');
    expect(doc.title).toBe('');
  });

  it('reads the JSON shape with its title', () => {
    const [doc] = parsePropertyDocuments([
      JSON.stringify({
        url: 'property-documents/a1/deed.pdf',
        title: 'Sale Deed',
      }),
    ]);
    expect(doc.title).toBe('Sale Deed');
    expect(doc.url).toContain('deed.pdf');
  });

  it('falls back to the plain path when the JSON is malformed', () => {
    const [doc] = parsePropertyDocuments(['{not json']);
    expect(doc.url).toContain('{not json');
    expect(doc.title).toBe('');
  });

  it('drops blank entries and entries that resolve to no url', () => {
    expect(
      parsePropertyDocuments([
        '  ',
        '',
        JSON.stringify({ url: '', title: 'x' }),
      ])
    ).toEqual([]);
  });
});

describe('documentDisplayName', () => {
  it('strips the upload prefix, with and without the nonce segment', () => {
    expect(
      documentDisplayName(
        'https://x.co/a1b2c3d4-0000-0000-0000-000000000000/doc-1234-Sale_Deed.pdf',
        0
      )
    ).toBe('Sale_Deed.pdf');
    expect(
      documentDisplayName('https://x.co/acct/doc-1234-a8f3-Khata.pdf', 0)
    ).toBe('Khata.pdf');
  });

  it('leaves a filename that carries no upload prefix alone', () => {
    expect(documentDisplayName('https://x.co/acct/Encumbrance.pdf', 0)).toBe(
      'Encumbrance.pdf'
    );
  });

  it('drops the query string', () => {
    expect(documentDisplayName('https://x.co/acct/deed.pdf?token=abc', 0)).toBe(
      'deed.pdf'
    );
  });

  it('falls back to a numbered label when nothing readable remains', () => {
    expect(documentDisplayName('https://x.co/', 2)).toBe('Document 3');
  });
});
