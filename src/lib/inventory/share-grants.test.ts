import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SHARE_GRANT_TTL_MS,
  mintShareGrantToken,
  isGrantLive,
  grantedReveals,
  resolveShareGrant,
  type ShareGrant,
} from './share-grants';

const baseGrant: ShareGrant = {
  id: 'g1',
  account_id: 'a1',
  property_id: 'p1',
  contact_id: 'c1',
  token: 'x'.repeat(48),
  reveal_location: true,
  reveal_documents: true,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  revoked_at: null,
  view_count: 0,
  last_viewed_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

/** Minimal stand-in for the one query resolveShareGrant runs. */
function stubAdmin(row: ShareGrant | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, eq };
}

describe('mintShareGrantToken', () => {
  it('mints a 48-char token with the configured TTL', () => {
    const before = Date.now();
    const { token, expiresAt } = mintShareGrantToken();
    expect(token).toHaveLength(48);
    expect(token).toMatch(/^[0-9a-f]+$/);
    const ttl = new Date(expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(SHARE_GRANT_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(SHARE_GRANT_TTL_MS + 5_000);
  });

  it('does not repeat itself', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintShareGrantToken().token)
    );
    expect(tokens.size).toBe(50);
  });
});

describe('isGrantLive', () => {
  it('accepts an unexpired, unrevoked grant', () => {
    expect(isGrantLive(baseGrant)).toBe(true);
  });

  it('rejects a revoked grant even before it expires', () => {
    expect(
      isGrantLive({ ...baseGrant, revoked_at: new Date().toISOString() })
    ).toBe(false);
  });

  it('rejects an expired grant', () => {
    expect(
      isGrantLive({
        ...baseGrant,
        expires_at: new Date(Date.now() - 1_000).toISOString(),
      })
    ).toBe(false);
  });
});

describe('grantedReveals', () => {
  it('reveals nothing without a grant', () => {
    expect(grantedReveals(null)).toEqual({ location: false, documents: false });
  });

  it('reveals nothing for a dead grant, whatever its flags say', () => {
    expect(
      grantedReveals({ ...baseGrant, revoked_at: new Date().toISOString() })
    ).toEqual({ location: false, documents: false });
  });

  it('passes through the flags of a live grant', () => {
    expect(grantedReveals({ ...baseGrant, reveal_documents: false })).toEqual({
      location: true,
      documents: false,
    });
  });
});

describe('resolveShareGrant', () => {
  it('resolves a live grant for its own property', async () => {
    const { client } = stubAdmin(baseGrant);
    await expect(
      resolveShareGrant(client, baseGrant.token, 'p1', 'a1')
    ).resolves.toEqual(baseGrant);
  });

  it('refuses a token minted for a different property', async () => {
    const { client } = stubAdmin(baseGrant);
    await expect(
      resolveShareGrant(client, baseGrant.token, 'p2', 'a1')
    ).resolves.toBeNull();
  });

  it('refuses a token belonging to another account', async () => {
    const { client } = stubAdmin(baseGrant);
    await expect(
      resolveShareGrant(client, baseGrant.token, 'p1', 'a2')
    ).resolves.toBeNull();
  });

  it('refuses a revoked grant', async () => {
    const { client } = stubAdmin({
      ...baseGrant,
      revoked_at: new Date().toISOString(),
    });
    await expect(
      resolveShareGrant(client, baseGrant.token, 'p1', 'a1')
    ).resolves.toBeNull();
  });

  it('refuses an expired grant', async () => {
    const { client } = stubAdmin({
      ...baseGrant,
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    await expect(
      resolveShareGrant(client, baseGrant.token, 'p1', 'a1')
    ).resolves.toBeNull();
  });

  it('refuses an unknown token', async () => {
    const { client } = stubAdmin(null);
    await expect(
      resolveShareGrant(client, 'y'.repeat(48), 'p1', 'a1')
    ).resolves.toBeNull();
  });

  it('short-circuits a too-short token without querying', async () => {
    const { client, from } = stubAdmin(baseGrant);
    await expect(
      resolveShareGrant(client, 'abc', 'p1', 'a1')
    ).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
