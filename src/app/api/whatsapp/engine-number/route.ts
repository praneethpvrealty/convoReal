import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

// GET /api/whatsapp/engine-number
//
// The number a contact has to message for their replies to reach the
// Engine, plus the prefix a sandbox tenant's first message needs
// (webhook-handler strips it before anything downstream reads the
// text). Every other wa.me link in the app points outward at a
// contact; this one points inward, so an invite can be handed to one.
//
// Nothing is stored: whatsapp_config holds Meta's phone_number_id, not
// the dialable number, so the Cloud API is the only source for it.

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    const { data: config, error } = await ctx.supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status, integration_type, sandbox_code')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) throw error;
    if (!config || config.status !== 'connected') {
      return NextResponse.json(
        {
          error: 'No WhatsApp number is connected yet. Connect one in Settings → WhatsApp.',
          code: 'NOT_CONNECTED',
        },
        { status: 409 }
      );
    }

    if ((config.integration_type || 'official_api') === 'sandbox') {
      const { data: setting } = await supabaseAdmin()
        .from('system_settings')
        .select('value')
        .eq('key', 'sandbox_config')
        .maybeSingle();
      const sandbox = (setting as { value?: Record<string, unknown> } | null)?.value;
      const phone =
        sandbox?.enabled && sandbox?.phone_number_id ? String(sandbox.phone_number_id) : null;

      if (!phone) {
        return NextResponse.json(
          { error: 'The shared sandbox number is not available right now.', code: 'NO_SANDBOX_NUMBER' },
          { status: 409 }
        );
      }

      return NextResponse.json({
        data: {
          phone,
          prefix: config.sandbox_code ? `#${config.sandbox_code} ` : '',
          sandbox: true,
        },
      });
    }

    if (!config.access_token) {
      return NextResponse.json(
        { error: 'The connected number has no saved access token.', code: 'NO_TOKEN' },
        { status: 409 }
      );
    }

    let info;
    try {
      info = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
      });
    } catch (lookupErr) {
      console.error('[GET /api/whatsapp/engine-number] Meta lookup failed:', lookupErr);
      return NextResponse.json(
        { error: 'Could not read the connected number from Meta.', code: 'LOOKUP_FAILED' },
        { status: 502 }
      );
    }

    // verifyPhoneNumber falls back to the phone_number_id when Meta
    // withholds display_phone_number (test numbers), and that is an id,
    // not something anyone can message.
    if (!info.display_phone_number || info.display_phone_number === config.phone_number_id) {
      return NextResponse.json(
        {
          error: 'Meta does not expose a dialable number for this connection.',
          code: 'NO_DISPLAY_NUMBER',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      data: { phone: info.display_phone_number, prefix: '', sandbox: false },
    });
  } catch (err) {
    console.error('[GET /api/whatsapp/engine-number] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
