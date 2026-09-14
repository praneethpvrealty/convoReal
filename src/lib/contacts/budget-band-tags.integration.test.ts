// ============================================================
// budget-band-tags.integration.test.ts — REAL DATABASE integration test
//
// Covers migration 294: budget_band_bounds, sync_contact_budget_band and
// the sync_budget_band trigger on contacts.
//
// There is no unit suite to put this in. The rule lives in SQL on
// purpose — both surfaces write contacts directly through supabase-js,
// so a rule in src/lib would be a rule the mobile app can skip — and a
// mirrored TS copy would be a second source of truth to drift. Only
// Postgres can answer whether the trigger fires on the right columns
// and picks the right band.
//
// SAFETY: every row here belongs to one throwaway account created in
// beforeAll and deleted in afterAll. No existing account is read or
// written.
//
// GATING: matched by vitest.config.ts's `**/*.integration.test.ts`
// exclude, so `npm test` never picks it up. Run via
// `npm run test:integration`.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BANDS = [
  'Budget 20L-50L',
  'Budget 1-2Cr',
  'Budget 2-5Cr',
  'Budget 5-10Cr',
  'Budget 10-25Cr',
  'Budget 25-50Cr',
  'Budget 150Cr+',
];

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY)(
  'budget band tag sync (integration, real database)',
  () => {
    let admin: SupabaseClient;
    let userId: string;
    let accountId: string;
    const tagIds = new Map<string, string>();
    const contactIds: string[] = [];

    async function tagNamesOf(contactId: string): Promise<string[]> {
      const { data } = await admin
        .from('contact_tags')
        .select('tags(name)')
        .eq('contact_id', contactId);
      return ((data ?? []) as unknown as { tags: { name: string } | null }[])
        .map((row) => row.tags?.name)
        .filter((name): name is string => Boolean(name))
        .sort();
    }

    async function createContact(
      fields: Record<string, unknown>,
      tagNames: string[] = []
    ): Promise<string> {
      const { data, error } = await admin
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: `+9199${Math.floor(10000000 + Math.random() * 89999999)}`,
          name: 'Budget Band Test',
          classification: 'Buyer',
          ...fields,
        })
        .select('id')
        .single();
      if (error) throw new Error(`seed contact failed: ${error.message}`);
      const contactId = (data as { id: string }).id;
      contactIds.push(contactId);
      if (tagNames.length) {
        await admin.from('contact_tags').insert(
          tagNames.map((name) => ({
            contact_id: contactId,
            tag_id: tagIds.get(name)!,
          }))
        );
      }
      return contactId;
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email: `convoreal-budget-band-${stamp}@convoreal-test.invalid`,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: 'Budget Band Test' },
      });
      if (error || !created.user)
        throw new Error(`throwaway user failed: ${error?.message}`);
      userId = created.user.id;

      const { data: account } = await admin
        .from('accounts')
        .select('id')
        .eq('owner_user_id', userId)
        .maybeSingle();
      if (!account) throw new Error('handle_new_user() created no account');
      accountId = (account as { id: string }).id;

      const { data: tags, error: tagErr } = await admin
        .from('tags')
        .insert(
          [...BANDS, 'Commercial'].map((name) => ({
            account_id: accountId,
            name,
          }))
        )
        .select('id, name');
      if (tagErr) throw new Error(`seed tags failed: ${tagErr.message}`);
      for (const tag of (tags ?? []) as { id: string; name: string }[])
        tagIds.set(tag.name, tag.id);
    }, 30_000);

    afterAll(async () => {
      try {
        for (const id of contactIds)
          await admin.from('contacts').delete().eq('id', id);
        await admin.from('tags').delete().eq('account_id', accountId);
        await admin.from('accounts').delete().eq('id', accountId);
      } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
      }
    }, 30_000);

    it('reads the bounds of each band name', async () => {
      const { data } = await admin.rpc('budget_band_bounds', {
        p_tag_name: 'Budget 5-10Cr',
      });
      expect(data).toEqual([{ band_min: 50000000, band_max: 100000000 }]);
    });

    it('returns no bounds for a tag that is not a band', async () => {
      const { data } = await admin.rpc('budget_band_bounds', {
        p_tag_name: 'Commercial',
      });
      expect(data).toEqual([{ band_min: null, band_max: null }]);
    });

    it('swaps a stale band when the budget is corrected', async () => {
      // Dr K Bhagavan's record: tagged 25-50Cr, budget corrected to 5-6 Cr.
      const contactId = await createContact(
        { pref_budget_min: 50000000, pref_budget_max: 60000000 },
        ['Budget 25-50Cr', 'Commercial']
      );
      await admin
        .from('contacts')
        .update({ min_budget: 50000000, max_budget: 60000000 })
        .eq('id', contactId);

      expect(await tagNamesOf(contactId)).toEqual([
        'Budget 5-10Cr',
        'Commercial',
      ]);
    });

    it('bands a contact created with a budget', async () => {
      const contactId = await createContact({
        min_budget: 25000000,
        max_budget: 40000000,
      });
      expect(await tagNamesOf(contactId)).toEqual(['Budget 2-5Cr']);
    });

    it('follows an AI-parsed budget, not only a typed one', async () => {
      const contactId = await createContact({}, ['Budget 20L-50L']);
      await admin
        .from('contacts')
        .update({ pref_budget_min: 120000000, pref_budget_max: 180000000 })
        .eq('id', contactId);
      expect(await tagNamesOf(contactId)).toEqual(['Budget 10-25Cr']);
    });

    it('leaves the band alone when no budget is set', async () => {
      const contactId = await createContact({}, ['Budget 25-50Cr']);
      await admin
        .from('contacts')
        .update({ min_budget: null, max_budget: null })
        .eq('id', contactId);
      expect(await tagNamesOf(contactId)).toEqual(['Budget 25-50Cr']);
    });

    it('mints nothing when no band in the account fits', async () => {
      const contactId = await createContact({ min_budget: 1, max_budget: 2 });
      expect(await tagNamesOf(contactId)).toEqual([]);
    });

    it('does not disturb non-budget tags', async () => {
      const contactId = await createContact({ max_budget: 3000000 }, [
        'Commercial',
      ]);
      expect(await tagNamesOf(contactId)).toEqual([
        'Budget 20L-50L',
        'Commercial',
      ]);
    });
  }
);
