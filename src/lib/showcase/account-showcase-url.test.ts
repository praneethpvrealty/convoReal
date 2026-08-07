import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  accountShowcaseBase,
  accountPropertyShowcaseUrl,
} from './account-showcase-url';

function db(subdomain: string | null, throws = false): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  throws
                    ? Promise.reject(new Error('down'))
                    : Promise.resolve({ data: { subdomain }, error: null }),
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('accountShowcaseBase', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.convoreal.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the account's own subdomain when it has one", async () => {
    const base = await accountShowcaseBase(db('aryavartaventures'), 'acct-1');
    expect(base).toContain('https://aryavartaventures.convoreal.com');
  });

  it('falls back to the shared site with ?ref= so the right catalog renders', async () => {
    const base = await accountShowcaseBase(db(null), 'acct-1');
    expect(base).toContain('ref=acct-1');
    expect(base).not.toContain('aryavart');
  });

  it('falls back to the bare site when the lookup fails', async () => {
    const base = await accountShowcaseBase(db(null, true), 'acct-1');
    expect(base).toBe('https://www.convoreal.com');
  });
});

describe('accountPropertyShowcaseUrl', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.convoreal.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('addresses the listing by property code on the account subdomain', async () => {
    const url = await accountPropertyShowcaseUrl(
      db('aryavartaventures'),
      'acct-1',
      { id: 'bb2d5756-bf68-4185-8395-76117a015b95', property_code: 'PROP-1004' },
      'contact-9',
    );
    expect(url).toContain('https://aryavartaventures.convoreal.com');
    expect(url).toContain('property_id=PROP-1004');
    expect(url).toContain('v=contact-9');
    // The raw UUID is what the bot used to leak into buyer chats.
    expect(url).not.toContain('bb2d5756');
  });

  it('falls back to the id when the listing has no code', async () => {
    const url = await accountPropertyShowcaseUrl(db(null), 'acct-1', {
      id: 'prop-uuid',
    });
    expect(url).toContain('property_id=prop-uuid');
    expect(url).not.toContain('v=');
  });
});
