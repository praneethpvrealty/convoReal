import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  OCCASIONS,
  daysUntil,
  upcomingOccasions,
} from '@/lib/greetings/occasions';

// GET /api/greetings/occasions — the occasion catalog and what is coming
// up. The web imports the catalog directly; mobile reads it here rather
// than shipping its own copy of the festival dates, which shift every
// year and would go stale in an installed build.
export async function GET() {
  try {
    await getCurrentAccount();
    const now = new Date();

    return NextResponse.json({
      data: {
        occasions: OCCASIONS.map(({ id, label, emoji }) => ({
          id,
          label,
          emoji,
        })),
        upcoming: upcomingOccasions(now).map(({ occasion, date }) => ({
          id: occasion.id,
          label: occasion.label,
          emoji: occasion.emoji,
          date: date.toISOString(),
          daysUntil: daysUntil(date, now),
        })),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
