import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { graphRequest } from '@/lib/meta-ads/client';

// POST /api/meta-ads/disconnect
// Revokes the token with Meta (best-effort) and marks the connection
// disconnected. Keeps the row (and any ad_campaigns history, once
// Phase C exists) rather than deleting it, so past campaign/attribution
// data survives a disconnect.
export async function POST() {
  try {
    const ctx = await requireRole('owner');
    const admin = supabaseAdmin();

    const { data: config } = await admin
      .from('meta_ads_config')
      .select('access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (config?.access_token) {
      try {
        const accessToken = decrypt(config.access_token as string);
        await graphRequest('me/permissions', { accessToken, method: 'DELETE' });
      } catch (err) {
        // Best-effort — an already-expired/revoked token, or a
        // transient Meta error, must not block local disconnect.
        console.error('[POST /api/meta-ads/disconnect] Meta revoke failed (non-fatal):', err);
      }
    }

    // Leave the (now Meta-revoked, inert) encrypted token in place rather
    // than blanking it — avoids a decrypt('') edge case if any future
    // code path reads the row without checking `status` first, and the
    // token is harmless once Meta has revoked it.
    await admin
      .from('meta_ads_config')
      .update({
        status: 'disconnected',
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
