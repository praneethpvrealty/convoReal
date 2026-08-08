import { describe, it, expect } from 'vitest';
import {
  buildAgentInventoryDigestParams,
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
  LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
  countTemplateBodyParams,
} from './agent-inventory-digest-template';
import {
  OWNER_DIGEST_TEMPLATE_NAME,
  buildOwnerDigestTemplatePayload,
} from './owner-digest-template';

describe('agent digest template wiring', () => {
  it('sends through the owner digest template rather than one of its own', () => {
    // Four agent-specific submissions were all categorised Marketing by
    // Meta, and a category can never be edited afterwards. The owner
    // template is the one approved Utility asset — see this module's
    // header before adding a fifth name here.
    expect(AGENT_INVENTORY_DIGEST_TEMPLATE_NAME).toBe(OWNER_DIGEST_TEMPLATE_NAME);
    expect(AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES[0]).toBe(AGENT_INVENTORY_DIGEST_TEMPLATE_NAME);
  });

  it('keeps every burned agent name as a fallback, newest first', () => {
    expect(LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES).toEqual([
      'agent_property_digest',
      'agent_listing_activity_update',
      'agent_inventory_digest',
    ]);
    expect(LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES).not.toContain(
      AGENT_INVENTORY_DIGEST_TEMPLATE_NAME
    );
  });

  it('supplies exactly the params the shared template declares', () => {
    const owner = buildOwnerDigestTemplatePayload();
    const params = buildAgentInventoryDigestParams(
      'Deepak Sharma',
      3,
      'today',
      '2 new direct buyers · 1 new buyer via partner agents'
    );
    // A count mismatch is a Meta send error, so this is the contract
    // that keeps the shared template usable by both digests.
    expect(params).toHaveLength(countTemplateBodyParams(owner.body_text));
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

describe('countTemplateBodyParams', () => {
  it('counts distinct placeholders, so a legacy four-param body still sends', () => {
    expect(countTemplateBodyParams('Hi {{1}}, activity on {{2}}: {{3}} Next step: {{4}}')).toBe(4);
    expect(countTemplateBodyParams(buildOwnerDigestTemplatePayload().body_text)).toBe(3);
    expect(countTemplateBodyParams('{{1}} and {{1}} again')).toBe(1);
    expect(countTemplateBodyParams(null)).toBe(0);
  });
});
