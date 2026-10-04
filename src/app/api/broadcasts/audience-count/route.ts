import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { countAudienceOnServer } from '@/lib/broadcasts/sender';
import { parseAudience } from '@/lib/broadcasts/audience';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const body = await request.json().catch(() => null);
    const parsed = parseAudience(body?.audience);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const count = await countAudienceOnServer(
      ctx.supabase,
      ctx.accountId,
      parsed.audience,
      { optedInOnly: body?.optedInOnly === true }
    );

    return NextResponse.json({ data: { count } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
