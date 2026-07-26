// ============================================================
// DELETE /api/account/delete
//
// Self-service deletion of the CALLER's own login. Required by App
// Store Guideline 5.1.1(v) — the mobile app creates accounts (Owners
// Den signup), so it must also be able to delete one without leaving
// the app. The Den counterpart is DELETE /api/den/account.
//
// Two shapes, both terminal — neither ever tells the user to email
// support:
//
//   Owner    — the workspace is theirs, so it goes with them. Any
//              teammates are first relocated to fresh personal
//              accounts via remove_account_member (they keep their
//              login and their own empty workspace, exactly as if
//              they had been removed), then the accounts row is
//              deleted and every child table CASCADEs.
//   Member   — only their profile and login go. The workspace and
//              its data belong to the account, not to them.
//
// Ordering matters: accounts.owner_user_id is ON DELETE RESTRICT, so
// the accounts row must die before the auth user.
// ============================================================

import { NextResponse } from 'next/server';
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

let _admin: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `account:delete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Typed confirmation, mirroring the destructive-action pattern the
    // UI uses. Guards against a mis-wired client firing the verb.
    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;
    if (body?.confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'Send { confirm: "DELETE" } to confirm account deletion' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    if (ctx.role === 'owner') {
      const { data: members, error: membersError } = await admin
        .from('profiles')
        .select('user_id')
        .eq('account_id', ctx.accountId)
        .neq('user_id', ctx.userId);

      if (membersError) {
        console.error('[account/delete] member lookup failed:', membersError);
        return NextResponse.json(
          { error: 'Could not delete your account' },
          { status: 500 }
        );
      }

      // RLS-scoped call: the RPC authorises the caller as owner and
      // hands each teammate a fresh personal account.
      for (const member of members ?? []) {
        const { error } = await ctx.supabase.rpc('remove_account_member', {
          p_user_id: member.user_id,
        });
        if (error) {
          console.error('[account/delete] could not relocate member:', error);
          return NextResponse.json(
            { error: 'Could not move your teammates out of the workspace' },
            { status: 500 }
          );
        }
      }

      const { error: accountError } = await admin
        .from('accounts')
        .delete()
        .eq('id', ctx.accountId);

      if (accountError) {
        console.error('[account/delete] account delete failed:', accountError);
        return NextResponse.json(
          { error: 'Could not delete your workspace' },
          { status: 500 }
        );
      }
    } else {
      const { error: profileError } = await admin
        .from('profiles')
        .delete()
        .eq('user_id', ctx.userId);

      if (profileError) {
        console.error('[account/delete] profile delete failed:', profileError);
        return NextResponse.json(
          { error: 'Could not delete your account' },
          { status: 500 }
        );
      }
    }

    const { error: authError } = await admin.auth.admin.deleteUser(ctx.userId);
    if (authError) {
      console.error('[account/delete] auth user delete failed:', authError);
      return NextResponse.json(
        { error: 'Could not delete your login' },
        { status: 500 }
      );
    }

    console.log(
      `[account/delete] user ${ctx.userId} (${ctx.role}) deleted; account ${ctx.accountId} ${
        ctx.role === 'owner' ? 'PERMANENTLY DELETED' : 'retained'
      }`
    );

    return NextResponse.json({
      ok: true,
      workspaceDeleted: ctx.role === 'owner',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
