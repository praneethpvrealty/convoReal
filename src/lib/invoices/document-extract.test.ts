import { describe, expect, it } from 'vitest';

import {
  instructionsFor,
  isExtractableMimeType,
  parseJsonResponse,
  redactAadhaarNumbers,
  sanitiseExtraction,
} from './document-extract';

describe('redactAadhaarNumbers', () => {
  // [INV-006] The full number never leaves the file.
  it('masks a full Aadhaar however it is spaced', () => {
    expect(redactAadhaarNumbers('Aadhaar 1234 5678 9012')).toBe(
      'Aadhaar XXXX XXXX 9012'
    );
    expect(redactAadhaarNumbers('123456789012')).toBe('XXXX XXXX 9012');
    expect(redactAadhaarNumbers('1234-5678-9012')).toBe('XXXX XXXX 9012');
  });

  it('leaves numbers that are not Aadhaar-shaped alone', () => {
    expect(redactAadhaarNumbers('Account No.: 2673101011720')).toBe(
      'Account No.: 2673101011720'
    );
    expect(redactAadhaarNumbers('PIN 560098')).toBe('PIN 560098');
  });
});

describe('sanitiseExtraction', () => {
  // [INV-006] The prompt asks; this enforces.
  it('strips a full Aadhaar the model returned anyway', () => {
    const result = sanitiseExtraction({
      name: 'Pruthvi Rao',
      address_lines: ['No. 268, 8th Cross', 'Aadhaar 1234 5678 9012'],
      aadhaar_last4: '1234 5678 9012',
      notes: 'Card number 1234 5678 9012',
    });
    expect(JSON.stringify(result)).not.toContain('1234 5678 9012');
    expect(result.address_lines?.[1]).toBe('Aadhaar XXXX XXXX 9012');
    expect(result.aadhaar_last4).toBe('9012');
    expect(result.notes).toBe('Card number XXXX XXXX 9012');
  });

  it('keeps a well-formed identity read-out', () => {
    const result = sanitiseExtraction({
      document_type: 'Aadhaar',
      name: 'Pruthvi Rao',
      address_lines: [
        'No. 268, 8th Cross, Dr H. Srinivasaiah Road',
        'Rajarajeshwarinagar, Bengaluru',
      ],
      state_name: 'Karnataka',
      pincode: '560098',
      pan: 'abcde1234f',
      aadhaar_last4: '9012',
      date_of_birth: '1984-03-12',
    });
    expect(result).toMatchObject({
      document_type: 'aadhaar',
      name: 'Pruthvi Rao',
      state_name: 'Karnataka',
      pincode: '560098',
      pan: 'ABCDE1234F',
      aadhaar_last4: '9012',
      date_of_birth: '1984-03-12',
    });
    expect(result.address_lines).toHaveLength(2);
  });

  // A field the agent has to double-check is worth less than no field.
  it('drops a malformed PAN, pincode or date rather than proposing it', () => {
    const result = sanitiseExtraction({
      pan: 'NOTAPAN',
      pincode: '56009',
      date_of_birth: '12/03/1984',
    });
    expect(result.pan).toBeUndefined();
    expect(result.pincode).toBeUndefined();
    expect(result.date_of_birth).toBeUndefined();
  });

  it('rejects a pincode that starts with zero', () => {
    expect(sanitiseExtraction({ pincode: '012345' }).pincode).toBeUndefined();
  });

  it('reads a deed read-out including a comma-formatted consideration', () => {
    const result = sanitiseExtraction({
      document_type: 'sale_deed',
      parties: ['Ravi Kumar', 'Pruthvi Rao'],
      survey_number: '253/2',
      extent: '2400 Sq.Ft.',
      document_number: 'JPN-1-04521/2019-20',
      document_date: '2019-11-08',
      consideration: '1,62,00,000',
    });
    expect(result.consideration).toBe(16200000);
    expect(result.parties).toEqual(['Ravi Kumar', 'Pruthvi Rao']);
    expect(result.survey_number).toBe('253/2');
  });

  it('ignores a zero or unparseable consideration', () => {
    expect(
      sanitiseExtraction({ consideration: '0' }).consideration
    ).toBeUndefined();
    expect(
      sanitiseExtraction({ consideration: 'many' }).consideration
    ).toBeUndefined();
  });

  it('returns an empty proposal for junk rather than throwing', () => {
    expect(sanitiseExtraction(null)).toEqual({});
    expect(sanitiseExtraction('nope')).toEqual({});
    expect(sanitiseExtraction({ name: 42, address_lines: 'x' })).toEqual({});
  });

  it('caps runaway output', () => {
    const result = sanitiseExtraction({
      address_lines: Array.from({ length: 50 }, (_, i) => `line ${i}`),
      name: 'x'.repeat(5000),
    });
    expect(result.address_lines).toHaveLength(6);
    expect(result.name?.length).toBe(200);
  });
});

describe('parseJsonResponse', () => {
  it('parses plain JSON', () => {
    expect(parseJsonResponse('{"name":"Pruthvi"}')).toEqual({
      name: 'Pruthvi',
    });
  });

  it('unwraps a fenced block', () => {
    expect(parseJsonResponse('```json\n{"name":"Pruthvi"}\n```')).toEqual({
      name: 'Pruthvi',
    });
  });

  it('recovers an object buried in prose', () => {
    expect(
      parseJsonResponse(
        'Here is what I read: {"name":"Pruthvi"} — hope that helps'
      )
    ).toEqual({ name: 'Pruthvi' });
  });

  it('returns an empty object rather than throwing on junk', () => {
    expect(parseJsonResponse('no json at all')).toEqual({});
    expect(parseJsonResponse('')).toEqual({});
  });
});

describe('instructionsFor', () => {
  it('forbids the full Aadhaar in the identity prompt', () => {
    const prompt = instructionsFor('identity');
    expect(prompt).toContain('never return the full Aadhaar number');
    expect(prompt).toContain('aadhaar_last4');
  });

  it('asks for deed fields for a title document', () => {
    const prompt = instructionsFor('title_deed');
    expect(prompt).toContain('survey_number');
    expect(prompt).toContain('consideration');
  });

  it('tells the model to omit rather than guess', () => {
    expect(instructionsFor('identity')).toContain(
      'Omit a key entirely rather than guessing'
    );
  });
});

describe('isExtractableMimeType', () => {
  it('accepts the formats a phone camera or a scan produces', () => {
    expect(isExtractableMimeType('application/pdf')).toBe(true);
    expect(isExtractableMimeType('image/jpeg')).toBe(true);
    expect(isExtractableMimeType('image/png')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isExtractableMimeType('image/heic')).toBe(false);
    expect(isExtractableMimeType('application/zip')).toBe(false);
    expect(isExtractableMimeType(null)).toBe(false);
  });
});
