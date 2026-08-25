import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const { data: account, error: accountError } = await supabaseAdmin()
      .from('accounts')
      .select('beta_invite_id')
      .eq('id', ctx.accountId)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account?.beta_invite_id) {
      return NextResponse.json(
        { phone: null },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const { data: invite, error: inviteError } = await supabaseAdmin()
      .from('beta_invites')
      .select('invitee_phone')
      .eq('id', account.beta_invite_id)
      .maybeSingle();

    if (inviteError) throw inviteError;
    return NextResponse.json(
      { phone: invite?.invitee_phone || null },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
