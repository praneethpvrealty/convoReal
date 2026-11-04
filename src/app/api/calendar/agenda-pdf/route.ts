import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  agendaPdfUrl,
  isAgendaDate,
  istDateOf,
  mintAgendaPdfToken,
} from '@/lib/calendar/agenda-pdf-link';
import { publicSiteUrl } from '@/lib/deals/update-delivery';

export async function GET(request: Request) {
  try {
    const { userId, accountId } = await requireRole('viewer');
    const requested = new URL(request.url).searchParams.get('date');
    if (requested !== null && !isAgendaDate(requested)) {
      return NextResponse.json(
        { error: 'date must be YYYY-MM-DD', code: 'INVALID_DATE' },
        { status: 400 }
      );
    }
    const date = requested ?? istDateOf();
    const token = mintAgendaPdfToken({ accountId, userId, date });
    return NextResponse.json({
      data: { url: agendaPdfUrl(publicSiteUrl(request), token), date },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
