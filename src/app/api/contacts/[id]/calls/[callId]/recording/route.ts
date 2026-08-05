import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { storageObjectPath } from '@/lib/storage/url';

// GET /api/contacts/[id]/calls/[callId]/recording
// The call-recordings bucket is private (legal/deal calls), so
// playback goes through this authed route: prove account
// membership via RLS, then redirect to a short-lived signed URL.

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId, callId } = await params;

    const { data: call } = await ctx.supabase
      .from('contact_call_logs')
      .select('recording_url')
      .eq('id', callId)
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const objectPath = storageObjectPath(call?.recording_url);
    if (!objectPath || !objectPath.startsWith('call-recordings/')) {
      return NextResponse.json({ error: 'No recording for this call' }, { status: 404 });
    }

    const { data: signed, error } = await supabaseAdmin()
      .storage.from('call-recordings')
      .createSignedUrl(objectPath.slice('call-recordings/'.length), SIGNED_URL_TTL_SECONDS);

    if (error || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Recording unavailable' }, { status: 404 });
    }
    return NextResponse.redirect(signed.signedUrl);
  } catch (err) {
    return toErrorResponse(err);
  }
}
