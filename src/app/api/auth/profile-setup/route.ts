import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fullName, email } = await req.json();

    const nameVal = fullName?.trim();
    const emailVal = email?.trim().toLowerCase();

    if (!nameVal || !emailVal) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Use admin client (bypasses RLS) to query profiles & create account securely
    const admin = supabaseAdmin();

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, account_id, account_role, org_role')
      .eq('user_id', user.id)
      .maybeSingle();

    let resolvedAccountId = existingProfile?.account_id;

    if (!resolvedAccountId) {
      console.log('[SETUP API] No account linked. Bootstrapping account via Admin Client...');
      // 1. Insert new account (no RLS constraints since it's service role!)
      const { data: newAccount, error: accError } = await admin
        .from('accounts')
        .insert({
          name: `${nameVal}'s Account`,
          owner_user_id: user.id, // Explicitly link owner ID
        })
        .select('id')
        .maybeSingle();

      if (accError || !newAccount) {
        console.error('[SETUP API] Account insertion failed:', accError);
        return NextResponse.json({ error: `Failed to bootstrap account: ${accError?.message || 'Unknown error'}` }, { status: 500 });
      }

      resolvedAccountId = newAccount.id;
    }

    // 2. Upsert profile row (linked to the resolved account) using Admin Client
    const upsertPayload: Record<string, string | null> = {
      user_id: user.id,
      full_name: nameVal,
      email: emailVal,
      account_id: resolvedAccountId,
      account_role: existingProfile?.account_role || 'owner',
    };

    // If org_role is present or needed, preserve or set it
    if (existingProfile?.org_role) {
      upsertPayload.org_role = existingProfile.org_role;
    } else {
      upsertPayload.org_role = 'org_manager';
    }

    const { error: profileError } = await admin
      .from('profiles')
      .upsert(upsertPayload, {
        onConflict: 'user_id',
      });

    if (profileError) {
      console.error('[SETUP API] Profile upsert failed:', profileError);
      return NextResponse.json({ error: `Failed to save profile: ${profileError.message}` }, { status: 500 });
    }

    // 3. Attempt to link/update the email address in Supabase Auth user metadata
    try {
      await supabase.auth.updateUser({ email: emailVal });
    } catch (authErr) {
      console.warn('[SETUP API] Auth email update warning:', authErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[SETUP API] Unexpected error executing setup route:', err);
    const errMsg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
