import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

// GET /api/onboarding/status
// Returns which onboarding steps the account has completed.
// Used by the onboarding wizard to show/hide steps.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const [waRes, propRes, contactRes, emailSyncRes] = await Promise.all([
      ctx.supabase
        .from('whatsapp_config')
        .select('phone_number_id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('email_sync_configs')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('is_active', true),
    ]);

    return NextResponse.json({
      hasWhatsApp: (waRes.count ?? 0) > 0,
      hasProperties: (propRes.count ?? 0) > 0,
      hasContacts: (contactRes.count ?? 0) > 0,
      hasEmailLeadSync: (emailSyncRes.count ?? 0) > 0,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
