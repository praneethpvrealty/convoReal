import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { signOAuthState, generateNonce } from '@/lib/meta-ads/oauth-state';
import { META_API_VERSION } from '@/lib/meta-ads/client';

const NONCE_COOKIE = 'meta_ads_oauth_nonce';

// Scopes needed to list ad accounts/Pages, read insights, and create
// CTWA campaigns on the agent's behalf (Phase C).
const SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list'].join(',');

function oauthRedirectUri(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/meta-ads/oauth/callback`;
}

// GET /api/meta-ads/oauth/start
// Redirects the owner into Facebook's OAuth consent dialog. Only the
// account owner can connect ad billing — same tier the WhatsApp
// config and billing/cancel routes require.
export async function GET() {
  try {
    if (process.env.META_ADS_ENABLED !== 'true') {
      return NextResponse.json({ error: 'Meta Ads is not enabled yet.' }, { status: 404 });
    }

    const ctx = await requireRole('owner');

    const appId = process.env.META_ADS_APP_ID;
    const appSecret = process.env.META_ADS_APP_SECRET;
    if (!appId || !appSecret) {
      console.error('[GET /api/meta-ads/oauth/start] META_ADS_APP_ID/META_ADS_APP_SECRET not configured');
      return NextResponse.json({ error: 'Meta Ads is not configured on this server.' }, { status: 500 });
    }

    const nonce = generateNonce();
    const state = signOAuthState({ accountId: ctx.accountId, nonce, ts: Date.now() }, appSecret);

    const cookieStore = await cookies();
    cookieStore.set(NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60, // matches oauth-state.ts's MAX_STATE_AGE_MS
      path: '/api/meta-ads/oauth',
    });

    const dialogUrl = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
    dialogUrl.searchParams.set('client_id', appId);
    dialogUrl.searchParams.set('redirect_uri', oauthRedirectUri());
    dialogUrl.searchParams.set('scope', SCOPES);
    dialogUrl.searchParams.set('state', state);
    dialogUrl.searchParams.set('response_type', 'code');

    return NextResponse.redirect(dialogUrl.toString());
  } catch (err) {
    return toErrorResponse(err);
  }
}
