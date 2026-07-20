import { describe, it, expect } from 'vitest';
import {
  buildAgentInventoryDigestTemplatePayload,
  buildAgentInventoryDigestParams,
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
} from './agent-inventory-digest-template';
import { validateTemplatePayload } from './template-validators';

describe('buildAgentInventoryDigestTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildAgentInventoryDigestTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(AGENT_INVENTORY_DIGEST_TEMPLATE_NAME);
  });

  it('is a Utility template with the pause quick reply', () => {
    const payload = buildAgentInventoryDigestTemplatePayload();
    expect(payload.category).toBe('Utility');
    const quickReplies = (payload.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY');
    expect(quickReplies.map((b) => ('text' in b ? b.text : ''))).toContain('Pause updates');
  });

  it('provides a sample value for every body param', () => {
    const payload = buildAgentInventoryDigestTemplatePayload();
    const paramCount = new Set(payload.body_text.match(/\{\{\d+\}\}/g)).size;
    expect(payload.sample_values?.body?.length).toBe(paramCount);
  });
});

describe('buildAgentInventoryDigestParams', () => {
  it('builds first name, listings phrase, summary and closing line', () => {
    const params = buildAgentInventoryDigestParams(
      'Deepak Sharma',
      3,
      'today',
      '2 new direct buyers · 1 new buyer via partner agents',
      'Sign up free: https://www.convoreal.com/signup'
    );
    expect(params).toEqual([
      'Deepak',
      'your 3 referred listings (today)',
      '2 new direct buyers · 1 new buyer via partner agents',
      'Sign up free: https://www.convoreal.com/signup',
    ]);
  });

  it('uses singular phrasing for one property and a fallback name', () => {
    const params = buildAgentInventoryDigestParams(null, 1, 'this week', '1 direct buyer', 'x');
    expect(params[0]).toBe('there');
    expect(params[1]).toBe('your referred listing (this week)');
  });

  it('never produces empty or multi-line params', () => {
    const params = buildAgentInventoryDigestParams('  ', 2, 'today', '', '');
    for (const p of params) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/\n/);
    }
  });
});
