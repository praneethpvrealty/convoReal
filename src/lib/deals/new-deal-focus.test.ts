import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  focusNewDealJourney,
  newDealFocusSubject,
} from '@/lib/deals/new-deal-focus';

interface Fake {
  scope: 'team' | 'agent';
  owned: Record<string, string[]>;
  upserts: { row: Record<string, unknown>; options: unknown }[];
  tables?: string[];
}

function fakeSupabase(fake: Fake): SupabaseClient {
  const from = (table: string) => {
    fake.tables?.push(table);
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      single: async () => ({
        data: { journey_compartment_scope: fake.scope },
        error: null,
      }),
      maybeSingle: async () => ({
        data:
          filters.account_id === 'acct-1' &&
          (fake.owned[table] ?? []).includes(String(filters.id))
            ? { id: filters.id }
            : null,
        error: null,
      }),
      upsert: async (row: Record<string, unknown>, options: unknown) => {
        fake.upserts.push({ row, options });
        return { error: null };
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

const input = (deal: {
  contact_id: string | null;
  property_id: string | null;
}) => ({ accountId: 'acct-1', userId: 'agent-1', deal });

describe('[TXW-029] a new deal puts its journey in Focus', () => {
  it('picks the buyer journey, or the listing journey when there is no buyer', () => {
    expect(
      newDealFocusSubject({ contact_id: 'c1', property_id: 'p1' })
    ).toEqual({ mode: 'buyer', subjectId: 'c1' });
    expect(
      newDealFocusSubject({ contact_id: null, property_id: 'p1' })
    ).toEqual({ mode: 'property', subjectId: 'p1' });
    expect(newDealFocusSubject({ contact_id: null, property_id: null })).toBe(
      null
    );
  });

  it("writes the team's Focus row when the account shares one split", async () => {
    const fake: Fake = {
      scope: 'team',
      owned: { contacts: ['c1'] },
      upserts: [],
    };
    await expect(
      focusNewDealJourney(
        fakeSupabase(fake),
        input({ contact_id: 'c1', property_id: 'p1' })
      )
    ).resolves.toEqual({ mode: 'buyer', subjectId: 'c1' });
    expect(fake.upserts).toEqual([
      {
        row: {
          account_id: 'acct-1',
          mode: 'buyer',
          subject_id: 'c1',
          user_id: null,
          compartment: 'focus',
          created_by: 'agent-1',
        },
        options: { onConflict: 'account_id,mode,subject_id,user_id' },
      },
    ]);
  });

  it("writes the creating agent's own Focus row when each agent keeps their own", async () => {
    const fake: Fake = {
      scope: 'agent',
      owned: { properties: ['p1'] },
      upserts: [],
    };
    await focusNewDealJourney(
      fakeSupabase(fake),
      input({ contact_id: null, property_id: 'p1' })
    );
    expect(fake.upserts[0].row).toMatchObject({
      mode: 'property',
      subject_id: 'p1',
      user_id: 'agent-1',
      compartment: 'focus',
    });
  });

  it('never reopens a paused, closed or archived journey', async () => {
    const fake: Fake = {
      scope: 'team',
      owned: { contacts: ['c1'] },
      upserts: [],
      tables: [],
    };
    await focusNewDealJourney(
      fakeSupabase(fake),
      input({ contact_id: 'c1', property_id: null })
    );
    expect(fake.tables).not.toContain('journey_overview_states');
    expect(new Set(fake.tables)).toEqual(
      new Set(['contacts', 'accounts', 'journey_compartments'])
    );
  });

  it('writes nothing for a buyer outside the account', async () => {
    const fake: Fake = { scope: 'team', owned: { contacts: [] }, upserts: [] };
    await expect(
      focusNewDealJourney(
        fakeSupabase(fake),
        input({ contact_id: 'someone-else', property_id: null })
      )
    ).resolves.toBe(null);
    expect(fake.upserts).toEqual([]);
  });
});
