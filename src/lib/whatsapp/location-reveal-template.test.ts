import { describe, it, expect } from 'vitest';
import {
  buildLocationRevealTemplatePayload,
  buildLocationRevealParams,
  LOCATION_REVEAL_TEMPLATE_NAME,
} from './location-reveal-template';
import { validateTemplatePayload } from './template-validators';

describe('buildLocationRevealTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com'
    );
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(LOCATION_REVEAL_TEMPLATE_NAME);
  });

  it('is a Utility template — exempt from marketing frequency caps', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com'
    );
    expect(payload.category).toBe('Utility');
  });

  it('carries the reveal token as a URL button suffix', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com/'
    );
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe(
      'https://www.convoreal.com/reveal/{{1}}'
    );
  });
});

describe('buildLocationRevealParams', () => {
  it('uses the first name, property title, specs and address', () => {
    expect(
      buildLocationRevealParams(
        'Rahul Sharma',
        'Villa in Whitefield',
        'Villa · 3 BHK · 2400 sqft · ₹2.4 Cr',
        '12, 5th Main, HSR Layout'
      )
    ).toEqual([
      'Rahul',
      'Villa in Whitefield',
      'Villa · 3 BHK · 2400 sqft · ₹2.4 Cr',
      '12, 5th Main, HSR Layout',
    ]);
  });

  it('never produces empty params', () => {
    expect(buildLocationRevealParams(null, '   ')).toEqual([
      'there',
      'the property',
      'Full details on the link below',
      'Address on the link below',
    ]);
    expect(buildLocationRevealParams('  ', '', '  ', '')).toEqual([
      'there',
      'the property',
      'Full details on the link below',
      'Address on the link below',
    ]);
  });

  // Meta rejects a parameter containing a newline, and a stored address
  // routinely has one. Every param must survive as a single line.
  it('flattens newlines out of every param', () => {
    const params = buildLocationRevealParams(
      'Rahul',
      'Villa',
      'Villa\n3 BHK',
      '12, 5th Main\nHSR Layout\nBengaluru'
    );
    for (const p of params) {
      expect(p).not.toMatch(/[\n\r\t]/);
    }
    expect(params[3]).toBe('12, 5th Main HSR Layout Bengaluru');
  });

  it('fills every placeholder the template body declares', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com'
    );
    const placeholders = new Set(
      [...payload.body_text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])
    );
    expect(placeholders.size).toBe(
      buildLocationRevealParams('A', 'B', 'C', 'D').length
    );
    expect(payload.sample_values?.body).toHaveLength(placeholders.size);
  });
});
