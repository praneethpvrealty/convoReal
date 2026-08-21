import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processShareFeedbackFollowups } from '@/lib/whatsapp/share-feedback';

/**
 * Property share feedback followups — asks buyers if the property shared 
 * 30 minutes ago matched their requirements. 
 *
 * Auth: same constant-time shared-secret check as the other crons.
 */
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
    const sentCount = await processShareFeedbackFollowups(supabaseAdmin());
    if (sentCount > 0)
      console.log(`[share-feedback-followups] sent=${sentCount}`);
    return NextResponse.json({ sentCount });
  } catch (err) {
    console.error('[share-feedback-followups] processing failed:', err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
