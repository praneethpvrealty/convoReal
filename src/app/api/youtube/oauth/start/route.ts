import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { signOAuthState, generateNonce } from '@/lib/meta-ads/oauth-state';
import { buildAuthUrl } from '@/lib/youtube/client';

const NONCE_COOKIE = 'youtube_oauth_nonce';

function oauthRedirectUri(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/youtube/oauth/callback`;
}

// GET /api/youtube/oauth/start
// Redirects the owner into Google's OAuth consent dialog. Same
// state-signing + nonce-cookie scheme as the Meta Ads flow
// (src/lib/meta-ads/oauth-state.ts), signed with the Google client
// secret instead of the Meta app secret.
export async function GET() {
  try {
    const ctx = await requireRole('owner');

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error(
        '[GET /api/youtube/oauth/start] GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET not configured'
      );
      return NextResponse.json(
        { error: 'YouTube is not configured on this server.' },
        { status: 500 }
      );
    }

    const nonce = generateNonce();
    const state = signOAuthState(
      { accountId: ctx.accountId, nonce, ts: Date.now() },
      clientSecret
    );

    const cookieStore = await cookies();
    cookieStore.set(NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60, // matches oauth-state.ts's MAX_STATE_AGE_MS
      path: '/api/youtube/oauth',
    });

    return NextResponse.redirect(
      buildAuthUrl({ clientId, redirectUri: oauthRedirectUri(), state })
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
