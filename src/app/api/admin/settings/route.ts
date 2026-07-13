import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify role is super_admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Caller is a verified super_admin. Cross-tenant reads below use the
    // service-role client so RLS (which scopes accounts/profiles/etc. to
    // the caller's own account) doesn't silently hide other tenants.
    const admin = supabaseAdmin();

    // 1. Fetch system settings
    const { data: settings, error: settingsError } = await admin
      .from('system_settings')
      .select('*');

    if (settingsError) {
      console.error('Error fetching system settings:', settingsError);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    const parsedSettings: Record<string, unknown> = {};
    settings?.forEach((s: Record<string, unknown>) => {
      parsedSettings[s.key as string] = (s as { value?: unknown }).value;
    });

    // 2. Fetch overview metrics
    const { count: usersCount } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: orgsCount } = await admin
      .from('accounts')
      .select('*', { count: 'exact', head: true });

    // 3. Fetch all active WhatsApp configurations with owner detail
    const { data: configs } = await admin
      .from('whatsapp_config')
      .select('account_id, phone_number_id, status, integration_type');

    const { data: profiles } = await admin
      .from('profiles')
      .select('account_id, full_name, email')
      .eq('account_role', 'owner');

    const mappedConfigs = configs?.map((cfg) => {
      const owner = profiles?.find((p) => p.account_id === cfg.account_id);
      return {
        ...cfg,
        owner_name: owner?.full_name || 'Unknown',
        owner_email: owner?.email || 'N/A',
      };
    }) || [];

    // 4. Fetch list of all organizations/accounts
    const { data: accounts } = await admin
      .from('accounts')
      .select('id, name, created_at, status, archived_at')
      .order('created_at', { ascending: false });

    // Plan per account — accounts without a subscriptions row are
    // 'starter' (same default the account_plan_limits view applies).
    const { data: subscriptions } = await admin
      .from('subscriptions')
      .select('account_id, plan');

    const mappedOrgs = accounts?.map((acc) => {
      const orgOwner = profiles?.find((p) => p.account_id === acc.id);
      const sub = subscriptions?.find((s) => s.account_id === acc.id);
      return {
        ...acc,
        owner_name: orgOwner?.full_name || 'N/A',
        owner_email: orgOwner?.email || 'N/A',
        plan: sub?.plan || 'starter',
      };
    }) || [];

    return NextResponse.json({
      settings: parsedSettings,
      metrics: {
        usersCount: usersCount || 0,
        orgsCount: orgsCount || 0,
      },
      whatsappConfigs: mappedConfigs,
      organizations: mappedOrgs,
    });
  } catch (error) {
    console.error('Error in GET admin settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify role is super_admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verified super_admin; write system settings with the service-role
    // client (system_settings RLS is not scoped to this admin's account).
    const admin = supabaseAdmin();

    const body = await request.json();
    const { fallback_whatsapp_account_id, feature_toggles } = body;

    if (fallback_whatsapp_account_id !== undefined) {
      const { error: err } = await admin
        .from('system_settings')
        .upsert({
          key: 'fallback_whatsapp_account_id',
          value: fallback_whatsapp_account_id, // JSONB handles string or null directly
          updated_at: new Date().toISOString(),
        });
      if (err) throw err;
    }

    if (feature_toggles !== undefined) {
      const { error: err } = await admin
        .from('system_settings')
        .upsert({
          key: 'feature_toggles',
          value: feature_toggles,
          updated_at: new Date().toISOString(),
        });
      if (err) throw err;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST admin settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
