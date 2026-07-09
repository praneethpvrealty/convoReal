// ============================================================
// credit-engine.integration.test.ts — REAL DATABASE integration test
//
// Unlike burn.test.ts / grant.test.ts (which mock the Supabase client
// entirely and only assert the TS-side RPC call shape), this file
// calls the actual burn_credits_tx / admin_grant_credits_tx Postgres
// functions (migrations 089, 096) against the live, shared Supabase
// project via the real service_role client. That's the only way to
// verify: bucket-priority deduction order, the hard-block atomicity
// guarantee, the credit_wallets CHECK constraint never getting
// violated, and — the big one — that the `SELECT ... FOR UPDATE` row
// lock in burn_credits_tx actually prevents two concurrent burns from
// racing past a zero balance.
//
// SAFETY: this project's .env.local points at a live Supabase project
// with real accounts and real money-adjacent data. This file NEVER
// touches an existing account:
//   - beforeAll creates a brand-new throwaway auth user via the admin
//     API. handle_new_user() (fixed by migrations 098/099 — see their
//     commit for the two bugs that used to make this fail silently)
//     now synchronously creates its profiles + accounts + credit_wallets
//     rows in the same transaction as auth.users. This test reads back
//     THAT auto-created account (by owner_user_id) rather than
//     inserting its own — accounts.owner_user_id is uniquely
//     constrained (idx_accounts_one_per_owner, migration 017), so a
//     second manual insert for the same user now fails outright.
//     Falls back to a manual insert only if no trigger-created row is
//     found (e.g. the trigger being absent/disabled in some other
//     environment this file might run against), keeping the test
//     robust either way.
//   - getOrCreateWallet is still called afterward — idempotent, so it
//     no-ops if the trigger already created the wallet and creates one
//     itself in the fallback path.
//   - afterEach zeroes the throwaway wallet and wipes its ledger rows
//     between tests, so every test starts from a known balance.
//   - afterAll deletes the credit_transactions rows, the
//     credit_wallets row, the accounts row (in that order — accounts
//     FKs to auth.users with ON DELETE RESTRICT, so the account must
//     go before the user), then the throwaway auth user itself.
//   - Cleanup runs in try/finally so a failed assertion still leaves
//     no orphan rows.
//
// GATING: this file is excluded from vitest.config.ts's default
// include/exclude (see the `exclude` entry there) so it never runs as
// part of the fast `npm test` suite, which must pass with zero
// network access in environments without secrets configured (e.g. CI
// without SUPABASE_SERVICE_ROLE_KEY). It has its own vitest project
// config (vitest.integration.config.ts) and npm script
// (`npm run test:integration`). As a second, belt-and-suspenders
// safety net, the whole suite is also wrapped in
// describe.skipIf(...) below, so even a stray direct `vitest run`
// invocation of this file skips cleanly instead of crashing when
// credentials aren't available.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import dotenv from 'dotenv';
import type { SupabaseClient } from '@supabase/supabase-js';

// Load real credentials the same way scripts/grant-credits.js does.
// vitest.config.ts's `env` block only stubs ENCRYPTION_KEY /
// META_APP_SECRET for the mocked unit suite — it deliberately does
// NOT set Supabase credentials, so this is the only place they come
// from for this file.
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type WalletRow = {
  monthly_credits: number;
  bonus_credits: number;
  referral_credits: number;
  purchased_credits: number;
  promo_credits: number;
  total_credits: number;
};

type TxRow = {
  type: string;
  bucket: string;
  amount: number;
  balance_after: number;
};

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY)(
  'credit engine Postgres RPCs (integration, real database)',
  () => {
    let supabase: SupabaseClient;
    let userId: string;
    let accountId: string;

    async function getWallet(): Promise<WalletRow> {
      const { data, error } = await supabase
        .from('credit_wallets')
        .select('monthly_credits, bonus_credits, referral_credits, purchased_credits, promo_credits, total_credits')
        .eq('account_id', accountId)
        .single();
      if (error || !data) throw new Error(`wallet fetch failed: ${error?.message}`);
      return data as WalletRow;
    }

    async function getLedger(): Promise<TxRow[]> {
      const { data, error } = await supabase
        .from('credit_transactions')
        .select('type, bucket, amount, balance_after')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`ledger fetch failed: ${error.message}`);
      return (data ?? []) as TxRow[];
    }

    // Directly seed specific buckets on our own throwaway wallet — the
    // only RPC that grants is admin_grant_credits_tx, which always
    // targets `bonus`, so bucket-priority tests need a raw update.
    // total_credits is patched in the same call to satisfy the
    // `total_credits = sum(buckets)` CHECK constraint.
    async function seedWallet(partial: Partial<WalletRow>): Promise<void> {
      const current = await getWallet();
      const next: WalletRow = { ...current, ...partial };
      next.total_credits =
        next.monthly_credits + next.bonus_credits + next.referral_credits + next.purchased_credits + next.promo_credits;
      const { error } = await supabase.from('credit_wallets').update(next).eq('account_id', accountId);
      if (error) throw new Error(`wallet seed failed: ${error.message}`);
    }

    beforeAll(async () => {
      const { billingAdmin } = await import('@/lib/billing/admin-client');
      const { getOrCreateWallet } = await import('./wallet');
      supabase = billingAdmin();

      // A brand-new throwaway auth user — needed only so the
      // `accounts.owner_user_id` FK (NOT NULL, REFERENCES auth.users)
      // has something real to point at.
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const email = `convoreal-integration-test-${stamp}@convoreal-test.invalid`;
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: 'Integration Test Throwaway' },
      });
      if (createErr || !created.user) {
        throw new Error(`failed to create throwaway auth user: ${createErr?.message}`);
      }
      userId = created.user.id;

      // handle_new_user() should have already created an account owned
      // by this user (see file header). Read it back rather than
      // inserting our own — owner_user_id is uniquely constrained, so a
      // second insert for the same user would fail outright now that
      // the trigger actually runs.
      const { data: triggerAccount } = await supabase
        .from('accounts')
        .select('id')
        .eq('owner_user_id', userId)
        .maybeSingle();

      if (triggerAccount) {
        accountId = triggerAccount.id as string;
      } else {
        // Fallback for an environment where the trigger didn't fire.
        const { data: account, error: acctErr } = await supabase
          .from('accounts')
          .insert({ name: 'Integration Test Throwaway', owner_user_id: userId })
          .select('id')
          .single();
        if (acctErr || !account) {
          throw new Error(`failed to create throwaway account: ${acctErr?.message}`);
        }
        accountId = account.id as string;
      }

      // Get-or-create its wallet the same way every real credit-engine
      // entry point does (src/lib/credits/wallet.ts).
      await getOrCreateWallet(accountId, supabase);
    });

    afterEach(async () => {
      if (!accountId) return;
      // Wipe the ledger and zero every bucket so each test starts from
      // a clean, known balance regardless of what the previous test did.
      await supabase.from('credit_transactions').delete().eq('account_id', accountId);
      await supabase
        .from('credit_wallets')
        .update({
          monthly_credits: 0,
          bonus_credits: 0,
          referral_credits: 0,
          purchased_credits: 0,
          promo_credits: 0,
          total_credits: 0,
        })
        .eq('account_id', accountId);
    });

    afterAll(async () => {
      if (!supabase) return;
      try {
        if (accountId) {
          await supabase.from('credit_transactions').delete().eq('account_id', accountId);
          await supabase.from('credit_wallets').delete().eq('account_id', accountId);
          // accounts.owner_user_id -> auth.users is ON DELETE RESTRICT,
          // so the account must be deleted before the auth user.
          await supabase.from('accounts').delete().eq('id', accountId);
        }
      } finally {
        if (userId) {
          await supabase.auth.admin.deleteUser(userId);
        }
      }
    });

    // ------------------------------------------------------------
    // admin_grant_credits_tx (migration 096)
    // ------------------------------------------------------------
    describe('admin_grant_credits_tx', () => {
      it('adds N credits to the bonus bucket and inserts a matching ledger row', async () => {
        const N = 37;
        const before = await getWallet();

        const { data, error } = await supabase.rpc('admin_grant_credits_tx', {
          p_account_id: accountId,
          p_amount: N,
          p_description: 'integration test grant',
        });
        expect(error).toBeNull();

        const row = Array.isArray(data) ? data[0] : data;
        expect(row.balance_after).toBe(before.total_credits + N);

        const after = await getWallet();
        expect(after.bonus_credits).toBe(before.bonus_credits + N);
        expect(after.total_credits).toBe(before.total_credits + N);
        // CHECK (total_credits = sum of buckets) must still hold.
        expect(after.total_credits).toBe(
          after.monthly_credits + after.bonus_credits + after.referral_credits + after.purchased_credits + after.promo_credits,
        );

        const ledger = await getLedger();
        const grants = ledger.filter((t) => t.type === 'admin_grant');
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
          type: 'admin_grant',
          bucket: 'bonus',
          amount: N,
          balance_after: after.total_credits,
        });
      });

      it('rejects a non-positive amount', async () => {
        const zero = await supabase.rpc('admin_grant_credits_tx', {
          p_account_id: accountId,
          p_amount: 0,
          p_description: 'should be rejected',
        });
        expect(zero.error).not.toBeNull();

        const negative = await supabase.rpc('admin_grant_credits_tx', {
          p_account_id: accountId,
          p_amount: -5,
          p_description: 'should be rejected',
        });
        expect(negative.error).not.toBeNull();
      });
    });

    // ------------------------------------------------------------
    // burn_credits_tx (migration 089)
    // ------------------------------------------------------------
    describe('burn_credits_tx', () => {
      it('hard block: insufficient balance deducts nothing (all-or-nothing atomicity)', async () => {
        await seedWallet({ bonus_credits: 10 });

        const { data, error } = await supabase.rpc('burn_credits_tx', {
          p_account_id: accountId,
          p_feature: 'integration_test',
          p_cost: 15,
          p_hard_block: true,
        });
        expect(error).toBeNull();
        const row = Array.isArray(data) ? data[0] : data;

        expect(row.success).toBe(false);

        const after = await getWallet();
        expect(after.total_credits).toBe(10); // unchanged
        expect(after.bonus_credits).toBe(10); // unchanged

        // No ai_burn ledger row should have been written on a
        // hard-block rejection.
        const ledger = await getLedger();
        expect(ledger.filter((t) => t.type === 'ai_burn')).toHaveLength(0);
      });

      it('soft block: burns everything available and reports the deficit, floor is 0', async () => {
        await seedWallet({ bonus_credits: 10 });

        const { data, error } = await supabase.rpc('burn_credits_tx', {
          p_account_id: accountId,
          p_feature: 'integration_test',
          p_cost: 15,
          p_hard_block: false,
        });
        expect(error).toBeNull();
        const row = Array.isArray(data) ? data[0] : data;

        expect(row.success).toBe(true);
        expect(row.balance_after).toBe(0);
        expect(row.deficit).toBe(5);

        const after = await getWallet();
        expect(after.total_credits).toBe(0);
        expect(after.total_credits).toBeGreaterThanOrEqual(0); // never negative
      });

      it('respects bucket priority: monthly is drained before bonus', async () => {
        // total = 15 (monthly 5, bonus 10). Burning 8 should take all 5
        // from monthly first, then 3 from bonus.
        await seedWallet({ monthly_credits: 5, bonus_credits: 0 });
        const grant = await supabase.rpc('admin_grant_credits_tx', {
          p_account_id: accountId,
          p_amount: 10,
          p_description: 'seed bonus bucket for priority test',
        });
        expect(grant.error).toBeNull();

        const { data, error } = await supabase.rpc('burn_credits_tx', {
          p_account_id: accountId,
          p_feature: 'integration_test',
          p_cost: 8,
          p_hard_block: true,
        });
        expect(error).toBeNull();
        const row = Array.isArray(data) ? data[0] : data;
        expect(row.success).toBe(true);

        const after = await getWallet();
        expect(after.monthly_credits).toBe(0);
        expect(after.bonus_credits).toBe(7);
        expect(after.total_credits).toBe(7);

        const burns = (await getLedger()).filter((t) => t.type === 'ai_burn');
        expect(burns).toHaveLength(2);
        const monthlyBurn = burns.find((t) => t.bucket === 'monthly');
        const bonusBurn = burns.find((t) => t.bucket === 'bonus');
        expect(monthlyBurn?.amount).toBe(-5);
        expect(bonusBurn?.amount).toBe(-3);
      });

      it('concurrency guard: two concurrent hard-block burns cannot both succeed past zero', async () => {
        await seedWallet({ bonus_credits: 10 });

        const burn = () =>
          supabase.rpc('burn_credits_tx', {
            p_account_id: accountId,
            p_feature: 'integration_test_concurrency',
            p_cost: 8,
            p_hard_block: true,
          });

        const [r1, r2] = await Promise.all([burn(), burn()]);
        expect(r1.error).toBeNull();
        expect(r2.error).toBeNull();

        const row1 = Array.isArray(r1.data) ? r1.data[0] : r1.data;
        const row2 = Array.isArray(r2.data) ? r2.data[0] : r2.data;
        const successes = [row1.success, row2.success].filter(Boolean);

        // The SELECT ... FOR UPDATE row lock must serialize these two
        // calls — only one can see 10 available and succeed; the other
        // must see 2 remaining, be below cost 8, and hard-block-reject.
        expect(successes).toHaveLength(1);

        const after = await getWallet();
        expect(after.total_credits).toBe(2);
        expect(after.total_credits).toBeGreaterThanOrEqual(0); // never blew past zero
      });
    });
  },
);
