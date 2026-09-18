import { NextResponse } from 'next/server';

import {
  isValidOtpFormat,
  OTP_MAX_ATTEMPTS,
  otpMatches,
  signUnlock,
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

// POST /api/public/deal-share/[token]/otp/verify { code }
//
// Checks the latest open challenge for this link, at most five times,
// and answers with a signed unlock bound to the link. The unlock is
// the client's to hold; nothing is stored, and nothing about the
// stakeholder becomes an account.
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

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    if (!isValidOtpFormat(body?.code)) {
      return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const resolved = await resolveShareLink(admin, token);
    if (resolved.state !== 'live') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { link } = resolved;

    const { data: challenge } = await admin
      .from('deal_share_otp_challenges')
      .select('id, code_hash, expires_at, attempts, verified_at')
      .eq('link_id', link.id)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      !challenge ||
      new Date(challenge.expires_at) <= new Date() ||
      challenge.attempts >= OTP_MAX_ATTEMPTS
    ) {
      await logShareAccess(admin, link, 'otp_failed', request);
      return NextResponse.json(
        { error: 'That code has expired. Request a new one.', code: 'OTP_EXPIRED' },
        { status: 410 }
      );
    }

    const ok = otpMatches(body!.code as string, link.id, challenge.code_hash);
    await admin
      .from('deal_share_otp_challenges')
      .update(
        ok
          ? { verified_at: new Date().toISOString(), attempts: challenge.attempts + 1 }
          : { attempts: challenge.attempts + 1 }
      )
      .eq('id', challenge.id);

    if (!ok) {
      await logShareAccess(admin, link, 'otp_failed', request);
      const left = OTP_MAX_ATTEMPTS - challenge.attempts - 1;
      return NextResponse.json(
        {
          error:
            left > 0
              ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`
              : 'Too many attempts. Request a new code.',
        },
        { status: 401 }
      );
    }

    await logShareAccess(admin, link, 'otp_verified', request);
    const unlock = signUnlock(link.id);
    return NextResponse.json({ data: unlock });
  } catch (err) {
    console.error('[deal-share] otp verify failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
