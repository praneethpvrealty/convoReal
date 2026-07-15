import { describe, it, expect } from 'vitest';
import {
  buildOwnerDigestTemplatePayload,
  buildOwnerDigestParams,
  OWNER_DIGEST_TEMPLATE_NAME,
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
  it('builds first name, listings phrase and summary', () => {
    const params = buildOwnerDigestParams(
      'Gopi Krishnan',
      2,
      'this week',
      '4 new enquiries · 1 site visit scheduled'
    );
    expect(params).toEqual([
      'Gopi',
      'your 2 listings (this week)',
      '4 new enquiries · 1 site visit scheduled',
    ]);
  });

  it('uses singular phrasing for one property and a fallback name', () => {
    const params = buildOwnerDigestParams(null, 1, 'today', '1 showcase view');
    expect(params[0]).toBe('there');
    expect(params[1]).toBe('your listing (today)');
  });

  it('never produces empty or multi-line params', () => {
    const params = buildOwnerDigestParams('  ', 3, 'this week', '');
    for (const p of params) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/\n/);
    }
  });
});
