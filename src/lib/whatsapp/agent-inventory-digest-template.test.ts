import { describe, it, expect } from 'vitest';
import {
  buildAgentInventoryDigestTemplatePayload,
  buildAgentInventoryDigestParams,
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
  LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
  countTemplateBodyParams,
} from './agent-inventory-digest-template';
import { buildOwnerDigestTemplatePayload } from './owner-digest-template';
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

  it('keeps promotional wording out of the body and samples', () => {
    const payload = buildAgentInventoryDigestTemplatePayload();
    const reviewed = [payload.body_text, ...(payload.sample_values?.body ?? [])].join('\n');
    expect(reviewed).not.toMatch(/https?:\/\//);
    expect(reviewed).not.toMatch(/sign ?up|free|📣/i);
  });

  it('submits under a name Meta has not already categorised', () => {
    // A category is set once, at creation: every name Meta has ruled on
    // keeps its verdict for good, so the current name must be a new one
    // and the old ones must stay listed for the send-path fallback.
    expect(LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES).not.toContain(
      AGENT_INVENTORY_DIGEST_TEMPLATE_NAME
    );
    expect(LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES).toEqual([
      'agent_listing_activity_update',
      'agent_inventory_digest',
    ]);
    expect(AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES[0]).toBe(AGENT_INVENTORY_DIGEST_TEMPLATE_NAME);
    expect(/^[a-z0-9_]+$/.test(AGENT_INVENTORY_DIGEST_TEMPLATE_NAME)).toBe(true);
  });

  it('matches the shape of the Utility-approved owner digest', () => {
    const agent = buildAgentInventoryDigestTemplatePayload();
    const owner = buildOwnerDigestTemplatePayload();
    expect(countTemplateBodyParams(agent.body_text)).toBe(
      countTemplateBodyParams(owner.body_text)
    );
    expect(agent.footer_text).toBe(owner.footer_text);
    // A variable announced as a call to action is what Meta kept
    // reading as Marketing.
    expect(agent.body_text).not.toMatch(/next step/i);
  });

  it('provides a sample value for every body param', () => {
    const payload = buildAgentInventoryDigestTemplatePayload();
    const paramCount = new Set(payload.body_text.match(/\{\{\d+\}\}/g)).size;
    expect(payload.sample_values?.body?.length).toBe(paramCount);
  });
});

describe('countTemplateBodyParams', () => {
  it('counts distinct placeholders, so an older four-param body still sends', () => {
    expect(countTemplateBodyParams('Hi {{1}}, activity on {{2}}: {{3}} Next step: {{4}}')).toBe(4);
    expect(countTemplateBodyParams(buildAgentInventoryDigestTemplatePayload().body_text)).toBe(3);
    expect(countTemplateBodyParams('{{1}} and {{1}} again')).toBe(1);
    expect(countTemplateBodyParams(null)).toBe(0);
  });
});

describe('buildAgentInventoryDigestParams', () => {
  it('builds first name, listings phrase and summary', () => {
    const params = buildAgentInventoryDigestParams(
      'Deepak Sharma',
      3,
      'today',
      '2 new direct buyers · 1 new buyer via partner agents'
    );
    expect(params).toEqual([
      'Deepak',
      'your 3 referred listings (today)',
      '2 new direct buyers · 1 new buyer via partner agents',
    ]);
  });

  it('uses singular phrasing for one property and a fallback name', () => {
    const params = buildAgentInventoryDigestParams(null, 1, 'this week', '1 direct buyer');
    expect(params[0]).toBe('there');
    expect(params[1]).toBe('your referred listing (this week)');
  });

  it('never produces empty or multi-line params', () => {
    const params = buildAgentInventoryDigestParams('  ', 2, 'today', '');
    for (const p of params) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/\n/);
    }
  });
});
