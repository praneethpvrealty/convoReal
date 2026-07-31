import { describe, it, expect } from 'vitest';
import {
  buildConsentMessage,
  buildSeekerRedirectMessage,
  buildRevealMessage,
  buildCoBrokerRevealNotice,
  parseConsentReply,
  mintRevealToken,
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
} from './location-requests';

describe('buildConsentMessage', () => {
  const msg = buildConsentMessage({
    coBrokerName: 'Suresh',
    propertyTitle: 'Independent House in HSR Layout',
    requesterName: 'Rahul Sharma',
    requesterPhone: '+919876543210',
  });

  it('addresses the co-broker and names the property', () => {
    expect(msg).toContain('Hi Suresh');
    expect(msg).toContain('*Independent House in HSR Layout*');
  });

  it("masks the seeker's identity — never the raw name or phone", () => {
    expect(msg).toContain('Ra••• Sh•••');
    expect(msg).toContain('98•••••210');
    expect(msg).not.toContain('Rahul Sharma');
    expect(msg).not.toContain('9876543210');
  });

  it('reassures privacy and that the system sends the reveal', () => {
    expect(msg).toContain('not shared with the listing office');
    expect(msg).toContain('ConvoReal sends them the details directly');
    expect(msg).toContain('never comes from you personally');
  });
});

describe('buildSeekerRedirectMessage', () => {
  it('redirects the seeker to the person who shared the property', () => {
    const msg = buildSeekerRedirectMessage('Villa in Whitefield');
    expect(msg).toContain('*Villa in Whitefield*');
    expect(msg).toContain(
      'speak with the person who shared you the property details'
    );
    expect(msg).toContain('informed decision');
  });
});

describe('buildRevealMessage', () => {
  it('carries the reveal link and the 48-hour validity', () => {
    const msg = buildRevealMessage({
      requesterName: 'Rahul',
      propertyTitle: 'Villa in Whitefield',
      revealLink: 'https://app.convoreal.com/reveal/abc123',
    });
    expect(msg).toContain('Hi Rahul');
    expect(msg).toContain('https://app.convoreal.com/reveal/abc123');
    expect(msg).toContain('48 hours');
  });
});

describe('buildCoBrokerRevealNotice', () => {
  it('tells the sharer their client got the reveal, privately', () => {
    const msg = buildCoBrokerRevealNotice('Villa in Whitefield');
    expect(msg).toContain('*Villa in Whitefield*');
    expect(msg).toContain('details remain private');
  });
});

describe('parseConsentReply', () => {
  it('parses approve and decline button ids', () => {
    expect(parseConsentReply(`${CONSENT_APPROVE_PREFIX}req-1`)).toEqual({
      requestId: 'req-1',
      decision: 'approve',
    });
    expect(parseConsentReply(`${CONSENT_DECLINE_PREFIX}req-2`)).toEqual({
      requestId: 'req-2',
      decision: 'decline',
    });
  });

  it('ignores unrelated reply ids', () => {
    expect(parseConsentReply('share_property_yes:p1')).toBeNull();
    expect(parseConsentReply('browse_all_properties')).toBeNull();
    expect(parseConsentReply('')).toBeNull();
  });
});

describe('mintRevealToken', () => {
  it('mints a 48-char token with a future expiry', () => {
    const { token, expiresAt } = mintRevealToken();
    expect(token).toHaveLength(48);
    expect(token).toMatch(/^[a-f0-9]+$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(mintRevealToken().token).not.toBe(token);
  });
});
