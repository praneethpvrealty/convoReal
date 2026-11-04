import { NextResponse } from 'next/server';

import { buildAgendaPdf } from '@/lib/calendar/agenda-pdf';
import { verifyAgendaPdfToken } from '@/lib/calendar/agenda-pdf-link';
import { loadDailyAgenda } from '@/lib/calendar/daily-agenda';
import { activeMemberAccountName } from '@/lib/calendar/member-events';
import { clientIp } from '@/lib/deals/share-server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

function notFound() {
  return NextResponse.json(
    { error: 'This link has expired or is not valid', code: 'LINK_INVALID' },
    { status: 404 }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ipLimit = await checkRateLimit(
    `agendaPdfIp:${clientIp(request)}`,
    RATE_LIMITS.publicAgendaPdfIp
  );
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  const token = (await params).token;
  const claim = verifyAgendaPdfToken(token);
  if (!claim) return notFound();

  const linkLimit = await checkRateLimit(
    `agendaPdf:${claim.accountId}:${claim.userId}:${claim.date}`,
    RATE_LIMITS.publicAgendaPdf
  );
  if (!linkLimit.success) return rateLimitResponse(linkLimit);

  const admin = supabaseAdmin();
  try {
    const accountName = await activeMemberAccountName(
      admin,
      claim.accountId,
      claim.userId
    );
    if (!accountName) return notFound();

    const [{ data: profile }, agenda] = await Promise.all([
      admin
        .from('profiles')
        .select('full_name')
        .eq('user_id', claim.userId)
        .eq('account_id', claim.accountId)
        .maybeSingle(),
      loadDailyAgenda(admin, claim.accountId, claim.userId, claim.date),
    ]);

    const pdf = await buildAgendaPdf(agenda, {
      memberName: (profile?.full_name as string | null) ?? null,
      accountName,
    });
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="agenda-${claim.date}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    console.error('[agenda-pdf] render failed:', err);
    return NextResponse.json(
      { error: 'Could not build the agenda PDF' },
      { status: 500 }
    );
  }
}
