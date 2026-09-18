import { NextResponse } from 'next/server';

import { sendTransactionalEmail } from '@/lib/email';
import {
  generateOtpCode,
  hashOtpCode,
  OTP_TTL_MS,
} from '@/lib/deals/share-links';
import {
  clientIp,
  logShareAccess,
  resolveShareLink,
} from '@/lib/deals/share-server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRANDING } from '@/config/branding';

// POST /api/public/deal-share/[token]/otp — send a one-time code to the
// stakeholder's email. The code is hashed with the server key before
// it is stored and is never returned to the caller. No account, no
// session: the link plus the code is the whole identity.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const limit = await checkRateLimit(
      `dealShareOtp:${clientIp(request)}`,
      RATE_LIMITS.publicDealShareOtp
    );
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const resolved = await resolveShareLink(admin, token);
    if (resolved.state !== 'live') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { link, stakeholder } = resolved;
    if (!link.otp_required) {
      return NextResponse.json({ error: 'This link needs no code' }, { status: 409 });
    }
    if (!stakeholder.email) {
      return NextResponse.json(
        { error: 'No verified channel for this link. Ask the agent to add your email.' },
        { status: 409 }
      );
    }

    const code = generateOtpCode();
    const { error } = await admin.from('deal_share_otp_challenges').insert({
      link_id: link.id,
      code_hash: hashOtpCode(code, link.id),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    });
    if (error) {
      return NextResponse.json({ error: 'Could not start verification' }, { status: 500 });
    }

    const sent = await sendTransactionalEmail({
      to: stakeholder.email,
      subject: `${code} is your ${BRANDING.name} verification code`,
      html: `<p>Your one-time code to open the transaction is <strong style="font-size:20px;letter-spacing:2px">${code}</strong>.</p><p>It expires in 10 minutes. If you did not request it, ignore this email.</p>`,
      text: `Your one-time code to open the transaction is ${code}. It expires in 10 minutes.`,
    });
    if (!sent.success) {
      return NextResponse.json(
        { error: 'Could not send the code right now. Try again in a minute.' },
        { status: 502 }
      );
    }

    await logShareAccess(admin, link, 'otp_sent', request);
    return NextResponse.json({ data: { sent: true, channel: 'email' } });
  } catch (err) {
    console.error('[deal-share] otp send failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
