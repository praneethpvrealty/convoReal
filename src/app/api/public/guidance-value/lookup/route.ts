import { NextResponse } from 'next/server';

import { parseValuationOptions } from '@/lib/guidance-value/schedule-fields';
import { sanitiseSchedule } from '@/lib/guidance-value/schedule-fields';
import { lookupGuidanceValue } from '@/lib/guidance-value/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// POST /api/public/guidance-value/lookup
//
// The marketing-site guidance value finder. Takes a typed schedule as
// JSON and matches it against the imported notifications — a database
// search with no sign-in, no Gemini call and no credit burn. Reading a
// sale deed schedule stays behind sign-in on /api/guidance-value/lookup,
// so a multipart body is refused here rather than read.

const IP_LIMIT = { limit: 20, windowMs: 60_000 };
const GLOBAL_LIMIT = { limit: 300, windowMs: 60_000 };

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      {
        error:
          'Sign in to read a sale deed schedule. Enter the area and road to search here.',
        code: 'SIGN_IN_REQUIRED',
      },
      { status: 401 }
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const perIp = await checkRateLimit(`publicGuidance:ip:${ip}`, IP_LIMIT);
  if (!perIp.success) return rateLimitResponse(perIp);
  const global = await checkRateLimit('publicGuidance:global', GLOBAL_LIMIT);
  if (!global.success) return rateLimitResponse(global);

  const body = await request.json().catch(() => null);
  const schedule = sanitiseSchedule(body?.schedule);
  if (!schedule.locality && !schedule.village && !schedule.city) {
    return NextResponse.json(
      { error: 'Enter the area, layout or village to search.' },
      { status: 400 }
    );
  }

  try {
    const result = await lookupGuidanceValue(
      supabaseAdmin(),
      schedule,
      parseValuationOptions(body?.options)
    );
    return NextResponse.json(
      { data: result },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error(
      '[public guidance-value] lookup failed:',
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: 'Could not search the guidance value notifications.' },
      { status: 502 }
    );
  }
}
