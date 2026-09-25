import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { pollGuidanceBatches } from '@/lib/guidance-value/batch';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

// Collects finished Gemini batches of guidance value notifications and
// saves their rates. Auth matches the other cron routes: the shared
// secret via `x-cron-secret` or Vercel Cron's `Authorization: Bearer`,
// failing closed when no secret is configured.
export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({
      data: await pollGuidanceBatches(supabaseAdmin()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[guidance-value] batch poll failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
