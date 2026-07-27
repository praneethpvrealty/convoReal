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

      it('a retried burn with the same key inside the window is free', async () => {
        // burn.ts passes p_retry_key on every call so a redelivered
        // webhook does not charge twice. The mocked unit suite only
        // asserts the key reaches the RPC; whether the RPC honours it
        // is a question for Postgres.
        await seedWallet({ bonus_credits: 20 });

        const burn = (retryKey: string) =>
          supabase.rpc('burn_credits_tx', {
            p_account_id: accountId,
            p_feature: 'integration_test_retry',
            p_cost: 4,
            p_hard_block: true,
            p_retry_key: retryKey,
          });

        const first = await burn('retry-key-1');
        expect(first.error).toBeNull();
        expect((Array.isArray(first.data) ? first.data[0] : first.data).balance_after).toBe(16);

        const replay = await burn('retry-key-1');
        expect(replay.error).toBeNull();
        const replayRow = Array.isArray(replay.data) ? replay.data[0] : replay.data;
        expect(replayRow.success).toBe(true);
        expect(replayRow.balance_after).toBe(16);

        expect((await getWallet()).total_credits).toBe(16);
        // The replay short-circuits before the deduction, so it writes
        // no second ledger row either.
        expect((await getLedger()).filter((t) => t.type === 'ai_burn')).toHaveLength(1);

        // A different key is a different call, not a retry.
        const second = await burn('retry-key-2');
        expect(second.error).toBeNull();
        expect((await getWallet()).total_credits).toBe(12);
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

    // ------------------------------------------------------------
    // grant_subscription_credits_tx (migrations 089, 163)
    //
    // The function every plan activation/upgrade path calls. Until
    // migration 163 it wrote the buckets and total_credits in two
    // separate UPDATEs, so the non-deferrable
    // `total_credits = sum(buckets)` CHECK fired between them and the
    // grant aborted — and because every caller wraps it in
    // .catch()/log, the plan change still landed while the account
    // silently never received its credits. grant.test.ts mocks the
    // RPC away entirely, so only a real Postgres round trip can tell
    // that regression from a healthy grant.
    // ------------------------------------------------------------
    describe('grant_subscription_credits_tx', () => {
      it('sets the monthly bucket and the commitment bonus in one consistent row', async () => {
        const resetAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

        const { data, error } = await supabase.rpc('grant_subscription_credits_tx', {
          p_account_id: accountId,
          p_monthly_amount: 1000,
          p_bonus_delta: 250,
          p_reset_at: resetAt,
        });
        // A two-statement grant surfaces here as
        // "violates check constraint credit_wallets_check".
        expect(error).toBeNull();

        const row = Array.isArray(data) ? data[0] : data;
        expect(row.balance_after).toBe(1250);

        const after = await getWallet();
        expect(after.monthly_credits).toBe(1000);
        expect(after.bonus_credits).toBe(250);
        expect(after.total_credits).toBe(1250);

        const { data: walletRow } = await supabase
          .from('credit_wallets')
          .select('monthly_reset_at')
          .eq('account_id', accountId)
          .single();
        expect(walletRow?.monthly_reset_at).not.toBeNull();

        const ledger = await getLedger();
        expect(ledger.filter((t) => t.type === 'subscription_grant')).toEqual([
          { type: 'subscription_grant', bucket: 'monthly', amount: 1000, balance_after: 1250 },
        ]);
        expect(ledger.filter((t) => t.type === 'commitment_bonus')).toEqual([
          { type: 'commitment_bonus', bucket: 'bonus', amount: 250, balance_after: 1250 },
        ]);
      });

      it('resets a partially burned monthly bucket and books only the delta', async () => {
        // 700 credits already spent this cycle; the reset is "use it or
        // lose it", so the bucket goes back to the plan value but the
        // ledger records the 700 actually added.
        await seedWallet({ monthly_credits: 300 });

        const { error } = await supabase.rpc('grant_subscription_credits_tx', {
          p_account_id: accountId,
          p_monthly_amount: 1000,
          p_bonus_delta: 0,
          p_reset_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        });
        expect(error).toBeNull();

        const after = await getWallet();
        expect(after.monthly_credits).toBe(1000);
        expect(after.total_credits).toBe(1000);

        const grants = (await getLedger()).filter((t) => t.type === 'subscription_grant');
        expect(grants).toHaveLength(1);
        expect(grants[0].amount).toBe(700);
      });

      it('writes no ledger rows for a renewal that changes nothing', async () => {
        const renew = () =>
          supabase.rpc('grant_subscription_credits_tx', {
            p_account_id: accountId,
            p_monthly_amount: 1000,
            p_bonus_delta: 0,
            p_reset_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          });

        expect((await renew()).error).toBeNull();
        expect((await getLedger())).toHaveLength(1); // the initial grant

        // Same plan, same amount: the monthly delta is 0 and there is
        // no bonus, so a plain in-term renewal must stay silent rather
        // than spamming the ledger every billing event.
        expect((await renew()).error).toBeNull();
        expect((await getLedger())).toHaveLength(1);
        expect((await getWallet()).total_credits).toBe(1000);
      });

      it('rejects an account with no wallet rather than granting into nothing', async () => {
        const { error } = await supabase.rpc('grant_subscription_credits_tx', {
          p_account_id: crypto.randomUUID(),
          p_monthly_amount: 1000,
          p_bonus_delta: 0,
          p_reset_at: new Date().toISOString(),
        });
        expect(error).not.toBeNull();
      });
    });

    // ------------------------------------------------------------
    // purchase_credits_tx (migrations 089, 097)
    //
    // Shared by the Razorpay and Stripe top-up webhooks. Gateways
    // redeliver, so the idempotency below is the difference between a
    // paid-for top-up and two of them.
    // ------------------------------------------------------------
    describe('purchase_credits_tx', () => {
      // Unique per run: idx_credit_tx_gateway_order is unique across
      // the whole table, not per account, so a leftover row from a
      // crashed run must not collide with this one.
      const orderId = `integration-order-${Date.now()}`;

      it('credits the purchased bucket and stamps the gateway ids on the ledger row', async () => {
        const { data, error } = await supabase.rpc('purchase_credits_tx', {
          p_account_id: accountId,
          p_amount: 500,
          p_description: 'Integration test top-up',
          p_gateway: 'razorpay',
          p_gateway_payment_id: `${orderId}-pay`,
          p_gateway_order_id: orderId,
        });
        expect(error).toBeNull();

        const row = Array.isArray(data) ? data[0] : data;
        expect(row.success).toBe(true);
        expect(row.balance_after).toBe(500);

        const after = await getWallet();
        expect(after.purchased_credits).toBe(500);
        expect(after.total_credits).toBe(500);

        const { data: tx } = await supabase
          .from('credit_transactions')
          .select('type, bucket, amount, balance_after, payment_gateway, gateway_order_id')
          .eq('account_id', accountId)
          .eq('type', 'purchase')
          .single();
        // balance_after is back-filled after the wallet update — the
        // insert seeds it with 0.
        expect(tx).toMatchObject({
          bucket: 'purchased',
          amount: 500,
          balance_after: 500,
          payment_gateway: 'razorpay',
          gateway_order_id: orderId,
        });
      });

      it('credits nothing when the same gateway order is delivered twice', async () => {
        const purchase = () =>
          supabase.rpc('purchase_credits_tx', {
            p_account_id: accountId,
            p_amount: 500,
            p_description: 'Integration test top-up',
            p_gateway: 'razorpay',
            p_gateway_payment_id: `${orderId}-replay-pay`,
            p_gateway_order_id: `${orderId}-replay`,
          });

        expect((await purchase()).error).toBeNull();

        const replay = await purchase();
        // The unique_violation on gateway_order_id is caught inside the
        // function, so a redelivery is a `success: false` result rather
        // than an error the webhook has to interpret.
        expect(replay.error).toBeNull();
        const row = Array.isArray(replay.data) ? replay.data[0] : replay.data;
        expect(row.success).toBe(false);
        expect(row.balance_after).toBe(500);

        expect((await getWallet()).purchased_credits).toBe(500);
        expect((await getLedger()).filter((t) => t.type === 'purchase')).toHaveLength(1);
      });
    });

    // ------------------------------------------------------------
    // refund_credits_tx (migration 089)
    //
    // Called when an AI feature is charged up front and then fails.
    // ------------------------------------------------------------
    describe('refund_credits_tx', () => {
      it('returns the credits to the buckets the burn took them from', async () => {
        await seedWallet({ monthly_credits: 5, bonus_credits: 10 });

        const burn = await supabase.rpc('burn_credits_tx', {
          p_account_id: accountId,
          p_feature: 'integration_test_refund',
          p_cost: 8,
          p_hard_block: true,
        });
        expect(burn.error).toBeNull();

        const { data, error } = await supabase.rpc('refund_credits_tx', {
          p_account_id: accountId,
          p_feature: 'integration_test_refund',
          p_cost: 8,
          p_description: 'integration test refund',
        });
        expect(error).toBeNull();

        const row = Array.isArray(data) ? data[0] : data;
        const balanceAfter = typeof row === 'number' ? row : row.balance_after;
        expect(balanceAfter).toBe(15);

        // The whole point of walking the burn rows: 5 goes back to
        // monthly and 3 to bonus. Dumping all 8 into `purchased` would
        // balance the total while quietly converting expiring monthly
        // credits into permanent ones.
        const after = await getWallet();
        expect(after.monthly_credits).toBe(5);
        expect(after.bonus_credits).toBe(10);
        expect(after.purchased_credits).toBe(0);
        expect(after.total_credits).toBe(15);
      });

      it('will not refund the same burn twice', async () => {
        await seedWallet({ monthly_credits: 5, bonus_credits: 10 });

        const burn = await supabase.rpc('burn_credits_tx', {
          p_account_id: accountId,
          p_feature: 'integration_test_refund',
          p_cost: 8,
          p_hard_block: true,
        });
        expect(burn.error).toBeNull();

        const refund = () =>
          supabase.rpc('refund_credits_tx', {
            p_account_id: accountId,
            p_feature: 'integration_test_refund',
            p_cost: 8,
            p_description: 'integration test refund',
          });
        expect((await refund()).error).toBeNull();
        expect((await refund()).error).toBeNull();

        // Every burn row is already marked refunded, so the second call
        // takes the purchased fallback instead of restoring monthly and
        // bonus a second time.
        const after = await getWallet();
        expect(after.monthly_credits).toBe(5);
        expect(after.bonus_credits).toBe(10);
        expect(after.purchased_credits).toBe(8);
      });
    });
  },
);
