// ============================================================
// dashboard-rpcs.integration.test.ts — REAL DATABASE integration test
//
// Covers the five aggregate functions introduced by migrations 168-170:
// inventory_stats, dashboard_metrics, dashboard_conversations_series,
// dashboard_pipeline_donut and dashboard_response_samples.
//
// The unit suite around src/lib/dashboard cannot reach these. It mocks
// the Supabase client, so it only ever asserts the TS-side call shape
// and the post-processing done on the returned rows — a function body
// that references a column which does not exist still passes every one
// of those tests. Migration 170 shipped with exactly that bug
// (`s.account_id` on pipeline_stages, which is scoped through its
// parent pipeline instead) and nothing but applying it to Postgres
// could have caught it. That is what this file is for.
//
// AUTH: these functions are SECURITY DEFINER and guard on
// is_account_member(), which reads auth.uid() out of the JWT. The
// service_role client has no JWT, so calling them with it returns
// nothing and every assertion would pass vacuously. So the RPCs here
// are called through an anon-key client signed in as the throwaway
// user; service_role is used only to seed and to clean up.
//
// SAFETY: this project's .env.local points at a live Supabase project
// with real accounts. This file never touches an existing account:
//   - beforeAll creates two brand-new throwaway auth users. Each gets
//     its own account + profile from handle_new_user() (the profile's
//     org_role is derived from account_role by the
//     sync_legacy_account_role BEFORE INSERT trigger). One is the
//     member whose account is seeded and asserted against; the second
//     is a non-member, used to prove the membership guard actually
//     denies rather than merely being present.
//   - every seeded row names one of those two account_ids.
//   - afterAll deletes the seeded rows child-first, then the accounts,
//     then the auth users (accounts.owner_user_id -> auth.users is ON
//     DELETE RESTRICT, so the account must go first), in a try/finally
//     so a failed assertion still leaves no orphan rows.
//
// GATING: matched by vitest.config.ts's `**/*.integration.test.ts`
// exclude, so `npm test` never picks it up. Run via
// `npm run test:integration`. The describe.skipIf below is the second
// safety net for a stray direct `vitest run`.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY)(
  'dashboard + inventory aggregate RPCs (integration, real database)',
  () => {
    let admin: SupabaseClient;
    let authed: SupabaseClient;
    let outsider: SupabaseClient;
    let anon: SupabaseClient;

    let memberUserId: string;
    let outsiderUserId: string;
    let accountId: string;
    let outsiderAccountId: string;

    // One anchor for every seeded timestamp and every RPC bound, so the
    // windows below cannot drift apart mid-run. Offsets are minutes,
    // never calendar days: "today" is the last 2 hours and "yesterday"
    // the 24 before that, which keeps the fixtures away from midnight
    // and DST entirely.
    const NOW = Date.now();
    const at = (minutesAgo: number) =>
      new Date(NOW - minutesAgo * 60_000).toISOString();
    const TODAY_START = at(120);
    const YESTERDAY_START = at(26 * 60);

    async function insert(
      table: string,
      rows: Record<string, unknown>[]
    ): Promise<string[]> {
      const { data, error } = await admin.from(table).insert(rows).select('id');
      if (error) throw new Error(`seed ${table} failed: ${error.message}`);
      return (data ?? []).map((r) => (r as { id: string }).id);
    }

    async function signIn(
      email: string,
      password: string
    ): Promise<SupabaseClient> {
      const client = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error)
        throw new Error(`sign-in failed for ${email}: ${error.message}`);
      return client;
    }

    async function createThrowawayUser(
      label: string
    ): Promise<{ userId: string; accountId: string; client: SupabaseClient }> {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const email = `convoreal-dashboard-rpc-${label}-${stamp}@convoreal-test.invalid`;
      const password = crypto.randomUUID();

      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: `Dashboard RPC Test ${label}` },
        });
      if (createErr || !created.user) {
        throw new Error(
          `failed to create throwaway auth user: ${createErr?.message}`
        );
      }

      const { data: account } = await admin
        .from('accounts')
        .select('id')
        .eq('owner_user_id', created.user.id)
        .maybeSingle();
      if (!account) {
        throw new Error(
          `handle_new_user() did not create an account for ${email}; the RPC membership guard cannot be exercised without one`
        );
      }

      return {
        userId: created.user.id,
        accountId: account.id as string,
        client: await signIn(email, password),
      };
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
      anon = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const member = await createThrowawayUser('member');
      memberUserId = member.userId;
      accountId = member.accountId;
      authed = member.client;

      const nonMember = await createThrowawayUser('outsider');
      outsiderUserId = nonMember.userId;
      outsiderAccountId = nonMember.accountId;
      outsider = nonMember.client;

      // --- properties: 6, spanning every bucket inventory_stats counts
      await insert(
        'properties',
        (
          [
            ['Available', true, 'owner'],
            ['Available', true, 'owner'],
            ['Available', false, 'owner'],
            ['Sold', false, 'agent'],
            ['Under Contract', false, 'owner'],
            ['Pending Review', false, 'owner'],
          ] as const
        ).map(([status, is_published, listing_source], i) => ({
          account_id: accountId,
          title: `RPC test property ${i}`,
          price: 1_000_000 + i,
          location: 'Integration Test Locality',
          type: 'Apartment',
          status,
          is_published,
          listing_source,
        }))
      );

      // --- contacts: two countable, one hidden behind an archived
      // conversation (the account owner texting their own Engine number).
      const [contactA, contactB, contactC] = await insert('contacts', [
        {
          account_id: accountId,
          user_id: memberUserId,
          phone: `91900000${String(NOW).slice(-5)}1`,
          name: 'Today Contact',
          created_at: at(90),
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          phone: `91900000${String(NOW).slice(-5)}2`,
          name: 'Yesterday Contact',
          created_at: at(300),
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          phone: `91900000${String(NOW).slice(-5)}3`,
          name: 'Self Chat Contact',
          created_at: at(90),
        },
      ]);

      const [conv1, conv2, conv3] = await insert('conversations', [
        {
          account_id: accountId,
          user_id: memberUserId,
          contact_id: contactA,
          status: 'open',
          is_archived: false,
          created_at: at(90),
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          contact_id: contactB,
          status: 'open',
          is_archived: false,
          created_at: at(300),
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          contact_id: contactC,
          status: 'open',
          is_archived: true,
          created_at: at(90),
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          contact_id: contactA,
          status: 'closed',
          is_archived: false,
          created_at: at(90),
        },
      ]);

      // Distinct offsets throughout: dashboard_response_samples walks
      // these in created_at order, and ties would make which message
      // opens a block undefined.
      await insert('messages', [
        {
          account_id: accountId,
          conversation_id: conv1,
          sender_type: 'agent',
          content_text: 'a',
          created_at: at(300),
        },
        {
          account_id: accountId,
          conversation_id: conv1,
          sender_type: 'customer',
          content_text: 'b',
          created_at: at(90),
        },
        {
          account_id: accountId,
          conversation_id: conv1,
          sender_type: 'agent',
          content_text: 'c',
          created_at: at(80),
        },
        {
          account_id: accountId,
          conversation_id: conv1,
          sender_type: 'agent',
          content_text: 'd',
          created_at: at(70),
        },
        {
          account_id: accountId,
          conversation_id: conv2,
          sender_type: 'customer',
          content_text: 'e',
          created_at: at(300),
        },
        {
          account_id: accountId,
          conversation_id: conv2,
          sender_type: 'customer',
          content_text: 'f',
          created_at: at(295),
        },
        {
          account_id: accountId,
          conversation_id: conv2,
          sender_type: 'agent',
          content_text: 'g',
          created_at: at(270),
        },
        {
          account_id: accountId,
          conversation_id: conv3,
          sender_type: 'agent',
          content_text: 'h',
          created_at: at(90),
        },
        {
          account_id: accountId,
          conversation_id: conv3,
          sender_type: 'customer',
          content_text: 'i',
          created_at: at(95),
        },
      ]);

      const [pipelineId] = await insert('pipelines', [
        {
          account_id: accountId,
          user_id: memberUserId,
          name: 'RPC Test Pipeline',
        },
      ]);
      const [stageOne, stageTwo] = await insert('pipeline_stages', [
        {
          pipeline_id: pipelineId,
          name: 'Qualified',
          position: 1,
          color: '#eab308',
        },
        { pipeline_id: pipelineId, name: 'Closing', position: 2, color: '' },
        {
          pipeline_id: pipelineId,
          name: 'Empty Stage',
          position: 3,
          color: '#ffffff',
        },
      ]);

      await insert('deals', [
        {
          account_id: accountId,
          user_id: memberUserId,
          pipeline_id: pipelineId,
          stage_id: stageOne,
          title: 'Open, 2% fallback',
          status: 'open',
          value: 1_000_000,
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          pipeline_id: pipelineId,
          stage_id: stageOne,
          title: 'Open, explicit brokerage',
          status: 'open',
          value: 500_000,
          brokerage_amount: 75_000,
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          pipeline_id: pipelineId,
          stage_id: stageTwo,
          title: 'Open, 2% fallback, second stage',
          status: 'open',
          value: 2_000_000,
        },
        {
          account_id: accountId,
          user_id: memberUserId,
          pipeline_id: pipelineId,
          stage_id: stageOne,
          title: 'Won, must be excluded',
          status: 'won',
          value: 9_000_000,
        },
      ]);
    });

    afterAll(async () => {
      if (!admin) return;
      try {
        for (const id of [accountId, outsiderAccountId].filter(Boolean)) {
          await admin.from('messages').delete().eq('account_id', id);
          await admin.from('conversations').delete().eq('account_id', id);
          await admin.from('deals').delete().eq('account_id', id);
          const { data: pipelines } = await admin
            .from('pipelines')
            .select('id')
            .eq('account_id', id);
          for (const p of (pipelines ?? []) as { id: string }[]) {
            await admin
              .from('pipeline_stages')
              .delete()
              .eq('pipeline_id', p.id);
          }
          await admin.from('pipelines').delete().eq('account_id', id);
          await admin.from('contacts').delete().eq('account_id', id);
          await admin.from('properties').delete().eq('account_id', id);
          await admin.from('credit_transactions').delete().eq('account_id', id);
          await admin.from('credit_wallets').delete().eq('account_id', id);
          await admin.from('accounts').delete().eq('id', id);
        }
      } finally {
        for (const id of [memberUserId, outsiderUserId].filter(Boolean)) {
          await admin.auth.admin.deleteUser(id);
        }
      }
    });

    // ------------------------------------------------------------
    // inventory_stats (migration 168)
    // ------------------------------------------------------------
    describe('inventory_stats', () => {
      it('returns the eight counters from one pass over the account', async () => {
        const { data, error } = await authed
          .rpc('inventory_stats', { p_account_id: accountId })
          .maybeSingle<{
            total: number;
            published: number;
            available: number;
            sold_or_contract: number;
            pending_review: number;
            active_total: number;
            direct: number;
            agent_referred: number;
          }>();
        expect(error).toBeNull();

        expect(data).toMatchObject({
          total: 6,
          published: 2,
          available: 3,
          sold_or_contract: 2,
          pending_review: 1,
          active_total: 6,
          direct: 5,
          agent_referred: 1,
        });
      });
    });

    // ------------------------------------------------------------
    // dashboard_metrics (migration 169)
    // ------------------------------------------------------------
    describe('dashboard_metrics', () => {
      it('returns all nine counters in one row', async () => {
        const { data, error } = await authed
          .rpc('dashboard_metrics', {
            p_account_id: accountId,
            p_today_start: TODAY_START,
            p_yesterday_start: YESTERDAY_START,
          })
          .maybeSingle<Record<string, number>>();
        expect(error).toBeNull();
        expect(data).not.toBeNull();

        // conv1 + conv2 are open and unarchived; conv3 is archived and
        // conv4 is closed.
        expect(Number(data!.open_conversations)).toBe(2);
        expect(Number(data!.new_conversations_today)).toBe(1);
        expect(Number(data!.new_conversations_yesterday)).toBe(1);

        // contactC is excluded by the NOT EXISTS on its archived
        // conversation — the replacement for the old unbounded
        // `not.in.(...)` id list.
        expect(Number(data!.new_contacts_today)).toBe(1);
        expect(Number(data!.new_contacts_yesterday)).toBe(1);

        expect(Number(data!.open_deals_count)).toBe(3);
        // 1_000_000 * 0.02 + 75_000 explicit + 2_000_000 * 0.02
        expect(Number(data!.open_deals_value)).toBe(135_000);

        // Agent messages only, and only in unarchived conversations —
        // so conv3's agent message is not counted.
        expect(Number(data!.messages_today)).toBe(2);
        expect(Number(data!.messages_yesterday)).toBe(1);
      });
    });

    // ------------------------------------------------------------
    // dashboard_conversations_series (migration 170)
    // ------------------------------------------------------------
    describe('dashboard_conversations_series', () => {
      it('splits customer from agent+bot and drops archived conversations', async () => {
        const { data, error } = await authed.rpc(
          'dashboard_conversations_series',
          {
            p_account_id: accountId,
            p_start: YESTERDAY_START,
            p_time_zone: 'UTC',
          }
        );
        expect(error).toBeNull();

        const rows = (data ?? []) as {
          day: string;
          incoming: number;
          outgoing: number;
        }[];
        const incoming = rows.reduce((sum, r) => sum + Number(r.incoming), 0);
        const outgoing = rows.reduce((sum, r) => sum + Number(r.outgoing), 0);

        // Totals rather than per-day: which local day a fixture lands on
        // depends on the wall clock at run time, but the split and the
        // archived exclusion do not. conv3's two messages are excluded.
        expect(incoming).toBe(3);
        expect(outgoing).toBe(4);
      });
    });

    // ------------------------------------------------------------
    // dashboard_pipeline_donut (migration 170)
    // ------------------------------------------------------------
    describe('dashboard_pipeline_donut', () => {
      it('groups open deals by stage through the parent pipeline', async () => {
        const { data, error } = await authed.rpc('dashboard_pipeline_donut', {
          p_account_id: accountId,
        });
        expect(error).toBeNull();

        const rows = (data ?? []) as {
          stage_name: string;
          stage_color: string;
          deal_count: number;
          total_value: number;
        }[];

        // Ordered by stage position, and the empty third stage is
        // dropped by the HAVING rather than shipped as a zero slice.
        expect(rows.map((r) => r.stage_name)).toEqual(['Qualified', 'Closing']);

        expect(Number(rows[0].deal_count)).toBe(2);
        expect(Number(rows[0].total_value)).toBe(95_000);
        expect(rows[0].stage_color).toBe('#eab308');

        expect(Number(rows[1].deal_count)).toBe(1);
        expect(Number(rows[1].total_value)).toBe(40_000);
        // Empty colour falls back rather than reaching the chart as ''.
        expect(rows[1].stage_color).toBe('#64748b');
      });
    });

    // ------------------------------------------------------------
    // dashboard_response_samples (migration 170)
    // ------------------------------------------------------------
    describe('dashboard_response_samples', () => {
      it('pairs each unreplied customer run with the reply that ended it', async () => {
        const { data, error } = await authed.rpc('dashboard_response_samples', {
          p_account_id: accountId,
          p_start: YESTERDAY_START,
        });
        expect(error).toBeNull();

        const minutes = (
          (data ?? []) as { customer_at: string; response_at: string }[]
        )
          .map(
            (r) =>
              (new Date(r.response_at).getTime() -
                new Date(r.customer_at).getTime()) /
              60_000
          )
          .sort((a, b) => a - b);

        // conv1: customer at -90 answered at -80 => 10 minutes.
        // conv2: two customer messages (-300, -295) share one block, so
        // they yield a single sample anchored at the first, answered at
        // -270 => 30 minutes. conv3 is archived and contributes nothing.
        expect(minutes).toEqual([10, 30]);
      });
    });

    // ------------------------------------------------------------
    // The membership guard. Without these the suite above would pass
    // just as happily against a function with no is_account_member()
    // check at all.
    // ------------------------------------------------------------
    describe('tenancy guard', () => {
      it('returns nothing to a signed-in non-member of the account', async () => {
        const metrics = await outsider.rpc('dashboard_metrics', {
          p_account_id: accountId,
          p_today_start: TODAY_START,
          p_yesterday_start: YESTERDAY_START,
        });
        expect(metrics.error).toBeNull();
        expect(metrics.data ?? []).toHaveLength(0);

        const donut = await outsider.rpc('dashboard_pipeline_donut', {
          p_account_id: accountId,
        });
        expect(donut.error).toBeNull();
        expect(donut.data ?? []).toHaveLength(0);

        const series = await outsider.rpc('dashboard_conversations_series', {
          p_account_id: accountId,
          p_start: YESTERDAY_START,
          p_time_zone: 'UTC',
        });
        expect(series.error).toBeNull();
        expect(series.data ?? []).toHaveLength(0);

        const samples = await outsider.rpc('dashboard_response_samples', {
          p_account_id: accountId,
          p_start: YESTERDAY_START,
        });
        expect(samples.error).toBeNull();
        expect(samples.data ?? []).toHaveLength(0);
      });

      it('reports zeros, not another account totals, from inventory_stats', async () => {
        // Unlike the others this is an ungrouped aggregate, so the guard
        // failing still yields exactly one row — of zeros. Migration
        // 168's header calls this out; assert it rather than assuming
        // the empty-array shape the other four have.
        const { data, error } = await outsider
          .rpc('inventory_stats', { p_account_id: accountId })
          .maybeSingle<{ total: number; published: number }>();
        expect(error).toBeNull();
        expect(Number(data?.total ?? -1)).toBe(0);
        expect(Number(data?.published ?? -1)).toBe(0);
      });

      it('denies EXECUTE to an unauthenticated caller', async () => {
        // Migrations 168-170 each REVOKE from PUBLIC and anon. PostgREST
        // surfaces that as an error rather than an empty result.
        const results = await Promise.all([
          anon.rpc('inventory_stats', { p_account_id: accountId }),
          anon.rpc('dashboard_metrics', {
            p_account_id: accountId,
            p_today_start: TODAY_START,
            p_yesterday_start: YESTERDAY_START,
          }),
          anon.rpc('dashboard_pipeline_donut', { p_account_id: accountId }),
          anon.rpc('dashboard_conversations_series', {
            p_account_id: accountId,
            p_start: YESTERDAY_START,
            p_time_zone: 'UTC',
          }),
          anon.rpc('dashboard_response_samples', {
            p_account_id: accountId,
            p_start: YESTERDAY_START,
          }),
        ]);
        for (const r of results) {
          expect(r.error).not.toBeNull();
        }
      });
    });
  }
);
