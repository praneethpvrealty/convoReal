import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

// GET /api/meta-ads/config
// Connection status for the caller's account. Never returns the
// access token — only what the settings UI needs to render.
//
// meta_ads_config has RLS enabled with NO policies (it stores an
// encrypted ad-account access token) — every read/write goes through
// the service-role admin client, never the caller's RLS-scoped
// session client, so the sensitive column can never become reachable
// from the browser even by future accident (e.g. a `select('*')`
// added elsewhere). `requireRole` still gates WHO may call this route.
export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const { data: config, error } = await supabaseAdmin()
      .from('meta_ads_config')
      .select('status, ad_account_id, page_id, ig_account_id, currency, connected_at, fb_user_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/meta-ads/config] fetch error:', error);
      return NextResponse.json({ connected: false, reason: 'db_error' }, { status: 200 });
    }

    if (!config) {
      return NextResponse.json({ connected: false, reason: 'not_connected' }, { status: 200 });
    }

    return NextResponse.json({
      connected: config.status === 'connected',
      status: config.status,
      adAccountId: config.ad_account_id,
      pageId: config.page_id,
      igAccountId: config.ig_account_id,
      currency: config.currency,
      connectedAt: config.connected_at,
      // Whether the asset-selection step (§4.2) still needs completing.
      needsAssetSelection: config.status === 'connected' && !config.ad_account_id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
