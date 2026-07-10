import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { verifyOAuthState } from '@/lib/meta-ads/oauth-state';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  listPages,
  getMe,
} from '@/lib/meta-ads/client';

const NONCE_COOKIE = 'meta_ads_oauth_nonce';

function settingsUrl(base: string, params: Record<string, string>): string {
  const url = new URL('/settings', base);
  url.searchParams.set('tab', 'ads');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function oauthRedirectUri(appBase: string): string {
  return `${appBase.replace(/\/$/, '')}/api/meta-ads/oauth/callback`;
}

// GET /api/meta-ads/oauth/callback
// Facebook redirects the browser here after the consent dialog. This
// route always redirects back to Settings → Ads (success or error) —
// it never returns raw JSON, since the caller is a browser navigation,
// not a fetch client.
export async function GET(request: NextRequest) {
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const cookieStore = await cookies();

  // Always clear the one-time nonce cookie, whatever happens below.
  const clearNonceCookie = (res: NextResponse) => {
    res.cookies.set(NONCE_COOKIE, '', { maxAge: 0, path: '/api/meta-ads/oauth' });
    return res;
  };

  try {
    const { searchParams } = new URL(request.url);
    const errorParam = searchParams.get('error');
    if (errorParam) {
      // User denied consent, or Facebook returned an error directly.
      return clearNonceCookie(
        NextResponse.redirect(settingsUrl(appBase, { meta_ads_error: 'consent_denied' })),
      );
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const appId = process.env.META_ADS_APP_ID;
    const appSecret = process.env.META_ADS_APP_SECRET;

    if (!code || !appId || !appSecret) {
      return clearNonceCookie(
        NextResponse.redirect(settingsUrl(appBase, { meta_ads_error: 'invalid_request' })),
      );
    }

    const nonce = cookieStore.get(NONCE_COOKIE)?.value ?? null;
    const verified = verifyOAuthState(state, appSecret, nonce);
    if (!verified.valid) {
      console.error('[meta-ads oauth callback] state verification failed:', verified.reason);
      return clearNonceCookie(
        NextResponse.redirect(settingsUrl(appBase, { meta_ads_error: 'state_' + verified.reason })),
      );
    }

    // requireRole already confirms the current session is an owner;
    // separately confirm it's an owner of the SAME account the signed
    // state was minted for, so a stolen/replayed state (even one that
    // somehow passed signature+nonce) can't attach a connection to an
    // account the current browser session doesn't own.
    const ctx = await requireRole('owner');
    if (ctx.accountId !== verified.payload.accountId) {
      return clearNonceCookie(
        NextResponse.redirect(settingsUrl(appBase, { meta_ads_error: 'account_mismatch' })),
      );
    }

    const shortLived = await exchangeCodeForToken({
      code,
      redirectUri: oauthRedirectUri(appBase),
      appId,
      appSecret,
    });
    const longLived = await exchangeForLongLivedToken({
      shortLivedToken: shortLived.access_token,
      appId,
      appSecret,
    });

    const me = await getMe(longLived.access_token);
    const tokenExpiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
      : null;

    const admin = supabaseAdmin();
    await admin.from('meta_ads_config').upsert(
      {
        account_id: ctx.accountId,
        access_token: encrypt(longLived.access_token),
        token_expires_at: tokenExpiresAt,
        fb_user_id: me.id,
        status: 'connected',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    );

    // Auto-select assets when unambiguous; otherwise the settings UI
    // prompts the user to pick (GET /api/meta-ads/config's
    // needsAssetSelection flag drives that).
    const [adAccounts, pages] = await Promise.all([
      listAdAccounts(longLived.access_token).catch(() => []),
      listPages(longLived.access_token).catch(() => []),
    ]);

    if (adAccounts.length === 1 && pages.length === 1) {
      await admin
        .from('meta_ads_config')
        .update({
          ad_account_id: adAccounts[0].id,
          page_id: pages[0].id,
          ig_account_id: pages[0].instagram_business_account?.id ?? null,
          currency: adAccounts[0].currency,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId);
    }

    return clearNonceCookie(NextResponse.redirect(settingsUrl(appBase, { meta_ads_connected: '1' })));
  } catch (err) {
    console.error('[GET /api/meta-ads/oauth/callback] failed:', err);
    return clearNonceCookie(
      NextResponse.redirect(settingsUrl(appBase, { meta_ads_error: 'connection_failed' })),
    );
  }
}
