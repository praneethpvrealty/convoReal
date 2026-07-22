import { describe, it, expect } from 'vitest';
import {
  buildOwnerDigestTemplatePayload,
  buildOwnerDigestParams,
  buildOwnerDigestConsentTemplatePayload,
  buildOwnerDigestConsentParams,
  OWNER_DIGEST_TEMPLATE_NAME,
  OWNER_DIGEST_CONSENT_TEMPLATE_NAME,
  CONSENT_YES_TEXT,
  CONSENT_NO_TEXT,
} from './owner-digest-template';
import { validateTemplatePayload } from './template-validators';

describe('buildOwnerDigestTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildOwnerDigestTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(OWNER_DIGEST_TEMPLATE_NAME);
  });

  it('is a Utility template with the pause quick reply', () => {
    const payload = buildOwnerDigestTemplatePayload();
    expect(payload.category).toBe('Utility');
    const quickReplies = (payload.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY');
    expect(quickReplies.map((b) => ('text' in b ? b.text : ''))).toContain('Pause updates');
  });

  it('provides a sample value for every body param', () => {
    const payload = buildOwnerDigestTemplatePayload();
    const paramCount = new Set(payload.body_text.match(/\{\{\d+\}\}/g)).size;
    expect(payload.sample_values?.body?.length).toBe(paramCount);
  });
});

describe('buildOwnerDigestParams', () => {
  it('names both listings for two properties', () => {
    const params = buildOwnerDigestParams(
      'Gopi Krishnan',
      ['Premium Commercial Property, Hoodi', 'Vacant Plot, JP Nagar'],
      'this week',
      '4 new enquiries · 1 site visit scheduled'
    );
    expect(params).toEqual([
      'Gopi',
      'your listings "Premium Commercial Property, Hoodi" and "Vacant Plot, JP Nagar" (this week)',
      '4 new enquiries · 1 site visit scheduled',
    ]);
  });

  it('names the single property and falls back on the name', () => {
    const params = buildOwnerDigestParams(null, ['Vacant Plot, JP Nagar'], 'today', '1 showcase view');
    expect(params[0]).toBe('there');
    expect(params[1]).toBe('your listing "Vacant Plot, JP Nagar" (today)');
  });

  it('uses a count phrase for more than two properties', () => {
    const params = buildOwnerDigestParams('Gopi', ['A', 'B', 'C'], 'this week', 'x');
    expect(params[1]).toBe('your 3 listings ("A" and more) (this week)');
  });

  it('never produces empty or multi-line params', () => {
    const params = buildOwnerDigestParams('  ', ['', '  ', ''], 'this week', '');
    for (const p of params) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/\n/);
    }
  });
});

describe('buildOwnerDigestConsentTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildOwnerDigestConsentTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(OWNER_DIGEST_CONSENT_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('offers exactly the Yes/No quick replies the webhook parser understands', () => {
    const payload = buildOwnerDigestConsentTemplatePayload();
    const texts = (payload.buttons ?? []).map((b) => ('text' in b ? b.text : ''));
    expect(texts).toEqual([CONSENT_YES_TEXT, CONSENT_NO_TEXT]);
  });

  it('provides a sample value for every body param', () => {
    const payload = buildOwnerDigestConsentTemplatePayload();
    const paramCount = new Set(payload.body_text.match(/\{\{\d+\}\}/g)).size;
    expect(payload.sample_values?.body?.length).toBe(paramCount);
  });
});

describe('buildOwnerDigestConsentParams', () => {
  it('builds first name and a listings phrase that names the properties', () => {
    expect(
      buildOwnerDigestConsentParams('Gopi Krishnan', ['Premium Plot, Hoodi', 'Vacant Plot, JP Nagar'])
    ).toEqual(['Gopi', 'your listings "Premium Plot, Hoodi" and "Vacant Plot, JP Nagar"']);
    expect(buildOwnerDigestConsentParams(null, ['Premium Plot, Hoodi'])).toEqual([
      'there',
      'your listing "Premium Plot, Hoodi"',
    ]);
    expect(buildOwnerDigestConsentParams(null, [''])).toEqual(['there', 'your listing']);
  });
});
