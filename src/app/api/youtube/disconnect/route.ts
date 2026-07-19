import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { revokeToken } from '@/lib/youtube/client';

// POST /api/youtube/disconnect
// Revokes the refresh token with Google (best-effort) and marks the
// connection disconnected. Keeps the row so already-uploaded videos'
// tracking columns stay meaningful; videos already on the channel are
// untouched — they belong to the owner's channel, not to us.
export async function POST() {
  try {
    const ctx = await requireRole('owner');
    const admin = supabaseAdmin();

    const { data: config } = await admin
      .from('youtube_config')
      .select('refresh_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (config?.refresh_token) {
      try {
        await revokeToken(decrypt(config.refresh_token as string));
      } catch (err) {
        // Best-effort — an already-revoked token or transient Google
        // error must not block local disconnect.
        console.error(
          '[POST /api/youtube/disconnect] Google revoke failed (non-fatal):',
          err
        );
      }
    }

    // Leave the (now revoked, inert) encrypted token in place rather
    // than blanking it — same stance as the Meta Ads disconnect.
    await admin
      .from('youtube_config')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
