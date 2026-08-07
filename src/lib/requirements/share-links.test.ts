import { describe, expect, it } from 'vitest';
import {
  extractRequirementReference,
  isRequirementLinkLive,
  mintRequirementLinkToken,
  requirementLinkPath,
  requirementLinkTtlMs,
  REQUIREMENT_LINK_TTL_MS,
} from './share-links';

describe('mintRequirementLinkToken', () => {
  it('mints a long, unique, URL-safe token', () => {
    const a = mintRequirementLinkToken();
    const b = mintRequirementLinkToken();
    expect(a.token).toHaveLength(48);
    expect(a.token).toMatch(/^[0-9a-f]+$/);
    expect(a.token).not.toBe(b.token);
  });

  it('stamps the expiry from the ttl', () => {
    const { expiresAt } = mintRequirementLinkToken(60_000);
    const delta = new Date(expiresAt).getTime() - Date.now();
    expect(delta).toBeGreaterThan(30_000);
    expect(delta).toBeLessThanOrEqual(60_000);
  });
});

describe('requirementLinkTtlMs', () => {
  it('resolves known keys', () => {
    expect(requirementLinkTtlMs('24h')).toBe(24 * 60 * 60 * 1000);
    expect(requirementLinkTtlMs('30d')).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('falls back to the default for unknown keys', () => {
    expect(requirementLinkTtlMs('forever')).toBe(REQUIREMENT_LINK_TTL_MS);
    expect(requirementLinkTtlMs(null)).toBe(REQUIREMENT_LINK_TTL_MS);
  });
});

describe('isRequirementLinkLive', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it('is live until it expires', () => {
    expect(
      isRequirementLinkLive({ expires_at: future, revoked_at: null })
    ).toBe(true);
    expect(isRequirementLinkLive({ expires_at: past, revoked_at: null })).toBe(
      false
    );
  });

  it('dies the moment it is revoked', () => {
    expect(
      isRequirementLinkLive({ expires_at: future, revoked_at: past })
    ).toBe(false);
  });
});

describe('extractRequirementReference', () => {
  it('finds the reference anywhere in a message, case-insensitively', () => {
    expect(
      extractRequirementReference(
        "Hi! I'm responding to requirement req-a3f2 — I have a match."
      )
    ).toBe('REQ-A3F2');
  });

  it('ignores messages without one', () => {
    expect(
      extractRequirementReference('Do you have any 3BHK in HSR?')
    ).toBeNull();
    expect(extractRequirementReference(null)).toBeNull();
  });

  it('rejects near-misses outside the hex reference space', () => {
    expect(extractRequirementReference('REQ-GHJK')).toBeNull();
    expect(extractRequirementReference('REQ-A3F21')).toBeNull();
    expect(extractRequirementReference('PREQ-A3F2')).toBeNull();
  });
});

describe('requirementLinkPath', () => {
  it('builds the public path', () => {
    expect(requirementLinkPath('abc123')).toBe('/req/abc123');
  });
});
