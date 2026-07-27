// ============================================================
// account.integration.test.ts — REAL DATABASE integration test
//
// Covers getCurrentAccount() / requireRole() / requireOrgRole() —
// the chokepoint every account-scoped API route was routed through
// (see the "Route account-scoped API routes through the auth
// chokepoint" change). Fourteen route files now depend on this one
// query returning the right shape; if it breaks, they all 500.
//
// account.test.ts cannot reach that. It replaces the Supabase client
// with a stub whose `from().select().eq().maybeSingle()` returns a
// hand-written profile object, so the string actually sent to
// PostgREST is never parsed by anything:
//
//   .select("account_id, account_role, org_role, team_id,
//            account:accounts!inner(id, name, status)")
//
// A renamed column, a second profiles->accounts foreign key making
// the `accounts!inner` embed ambiguous, or an RLS policy that stops
// returning the joined account row would all leave those unit tests
// green. This file runs the real function against the real schema.
//
// AUTH: the module resolves its client through @/lib/supabase/server,
// which reads next/headers cookies and cannot run outside a request.
// That one import is mocked; everything below it — the query, the
// role checks, the archived block — is the genuine article.
//
// SAFETY: this project's .env.local points at a live Supabase project
// with real accounts. This file never touches an existing account:
//   - beforeAll creates two brand-new throwaway auth users, each of
//     which gets its own account + profile from handle_new_user().
//     The second is then moved into the first's account as an `agent`
//     so the role guards have a real non-owner to reject.
//   - afterAll deletes both accounts (profiles cascade) and then the
//     auth users, in a try/finally so a failed assertion still leaves
//     no orphan rows.
//
// GATING: matched by vitest.config.ts's `**/*.integration.test.ts`
// exclude, so `npm test` never picks it up. Run via
// `npm run test:integration`. The describe.skipIf below is the second
// safety net for a stray direct `vitest run`.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Whichever signed-in client the current test wants getCurrentAccount
// to run as. Hoisted so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({ client: null as SupabaseClient | null }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.client,
}));

import {
  getCurrentAccount,
  requireRole,
  requireOrgRole,
  AccountArchivedError,
  ForbiddenError,
  UnauthorizedError,
} from './account';

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY)(
  'auth chokepoint (integration, real database)',
  () => {
    let admin: SupabaseClient;
    let anon: SupabaseClient;

    let ownerUserId: string;
    let memberUserId: string;
    let accountId: string;
    let memberOwnAccountId: string;
    let ownerClient: SupabaseClient;
    let memberClient: SupabaseClient;

    async function createThrowawayUser(
      label: string
    ): Promise<{ userId: string; accountId: string; client: SupabaseClient }> {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const email = `convoreal-auth-chokepoint-${label}-${stamp}@convoreal-test.invalid`;
      const password = crypto.randomUUID();

      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: `Auth Chokepoint ${label}` },
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
          `handle_new_user() did not create an account for ${email}; getCurrentAccount has nothing to resolve`
        );
      }

      const client = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInErr } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) {
        throw new Error(`sign-in failed for ${email}: ${signInErr.message}`);
      }

      return {
        userId: created.user.id,
        accountId: account.id as string,
        client,
      };
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
      anon = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const owner = await createThrowawayUser('owner');
      ownerUserId = owner.userId;
      accountId = owner.accountId;
      ownerClient = owner.client;

      const member = await createThrowawayUser('member');
      memberUserId = member.userId;
      memberOwnAccountId = member.accountId;
      memberClient = member.client;

      // Move the second user into the first's account as an agent. The
      // sync_legacy_account_role trigger (migration 082) derives
      // org_role from account_role, so this is also what proves the two
      // columns getCurrentAccount reads stay in step.
      const { error } = await admin
        .from('profiles')
        .update({ account_id: accountId, account_role: 'agent' })
        .eq('user_id', memberUserId);
      if (error) {
        throw new Error(
          `failed to demote the member profile: ${error.message}`
        );
      }
    });

    afterAll(async () => {
      if (!admin) return;
      try {
        // Deleting the account cascades its profiles rows.
        for (const id of [accountId, memberOwnAccountId].filter(Boolean)) {
          await admin.from('accounts').delete().eq('id', id);
        }
      } finally {
        for (const id of [ownerUserId, memberUserId].filter(Boolean)) {
          await admin.auth.admin.deleteUser(id);
        }
      }
    });

    // ------------------------------------------------------------
    // getCurrentAccount
    // ------------------------------------------------------------
    describe('getCurrentAccount', () => {
      it('resolves the full context from the real profile + account join', async () => {
        h.client = ownerClient;
        const ctx = await getCurrentAccount();

        expect(ctx.userId).toBe(ownerUserId);
        expect(ctx.accountId).toBe(accountId);
        expect(ctx.role).toBe('owner');
        expect(ctx.orgRole).toBe('org_manager');
        expect(ctx.teamId).toBeNull();
        // The `accounts!inner(...)` embed resolved and was normalised
        // out of the array PostgREST returns it in.
        expect(ctx.account.id).toBe(accountId);
        expect(typeof ctx.account.name).toBe('string');
        expect(ctx.account.name.length).toBeGreaterThan(0);
      });

      it('resolves the demoted member at their synced agent roles', async () => {
        h.client = memberClient;
        const ctx = await getCurrentAccount();

        expect(ctx.userId).toBe(memberUserId);
        expect(ctx.accountId).toBe(accountId);
        expect(ctx.role).toBe('agent');
        expect(ctx.orgRole).toBe('org_agent');
      });

      it('throws UnauthorizedError when there is no session', async () => {
        h.client = anon;
        await expect(getCurrentAccount()).rejects.toBeInstanceOf(
          UnauthorizedError
        );
      });

      it('throws AccountArchivedError once the account is archived', async () => {
        const archive = await admin
          .from('accounts')
          .update({ status: 'archived', archived_at: new Date().toISOString() })
          .eq('id', accountId);
        expect(archive.error).toBeNull();

        try {
          h.client = ownerClient;
          await expect(getCurrentAccount()).rejects.toBeInstanceOf(
            AccountArchivedError
          );

          // The block sits in getCurrentAccount, so it must fire ahead
          // of every role check too — an archived owner is not merely
          // demoted, they are out.
          await expect(requireRole('viewer')).rejects.toBeInstanceOf(
            AccountArchivedError
          );
        } finally {
          await admin
            .from('accounts')
            .update({ status: 'active', archived_at: null })
            .eq('id', accountId);
        }
      });
    });

    // ------------------------------------------------------------
    // requireRole / requireOrgRole
    // ------------------------------------------------------------
    describe('role guards', () => {
      it('admits the owner at every level', async () => {
        h.client = ownerClient;
        await expect(requireRole('owner')).resolves.toMatchObject({
          accountId,
        });
        await expect(requireOrgRole('org_manager')).resolves.toMatchObject({
          accountId,
        });
      });

      it('admits the agent at agent level and rejects them above it', async () => {
        h.client = memberClient;
        await expect(requireRole('agent')).resolves.toMatchObject({
          accountId,
        });
        await expect(requireRole('admin')).rejects.toBeInstanceOf(
          ForbiddenError
        );
        await expect(requireOrgRole('org_agent')).resolves.toMatchObject({
          accountId,
        });
        await expect(requireOrgRole('org_manager')).rejects.toThrow(
          /Organization Manager/
        );
      });
    });
  }
);
