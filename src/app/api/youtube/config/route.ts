import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

// GET /api/youtube/config
// Connection status for the caller's account. Never returns the
// refresh token — youtube_config has RLS enabled with NO policies
// (same stance as meta_ads_config), so every read/write goes through
// the service-role admin client and the token column can never become
// reachable from the browser. `requireRole` still gates WHO may call.
export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const configured = Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );

    const { data: config, error } = await supabaseAdmin()
      .from('youtube_config')
      .select('status, channel_id, channel_title, auto_upload, connected_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/youtube/config] fetch error:', error);
      return NextResponse.json(
        { configured, connected: false, reason: 'db_error' },
        { status: 200 }
      );
    }

    if (!config) {
      return NextResponse.json(
        { configured, connected: false, reason: 'not_connected' },
        { status: 200 }
      );
    }

    return NextResponse.json({
      configured,
      connected: config.status === 'connected',
      status: config.status,
      channelId: config.channel_id,
      channelTitle: config.channel_title,
      autoUpload: config.auto_upload,
      connectedAt: config.connected_at,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/youtube/config  { autoUpload: boolean }
// Toggles automatic upload of freshly rendered listing videos.
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => ({}))) as {
      autoUpload?: unknown;
    };
    if (typeof body.autoUpload !== 'boolean') {
      return NextResponse.json(
        { error: 'autoUpload must be a boolean.' },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabaseAdmin()
      .from('youtube_config')
      .update({
        auto_upload: body.autoUpload,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)
      .select('auto_upload')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/youtube/config] update error:', error);
      return NextResponse.json(
        { error: 'Could not update the setting.' },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'No YouTube channel is connected.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      autoUpload: updated.auto_upload,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
