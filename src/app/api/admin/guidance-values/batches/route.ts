import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import {
  pollGuidanceBatches,
  queueGuidanceBatches,
} from '@/lib/guidance-value/batch';
import { classifyAiOutage } from '@/lib/guidance-value/rate-parse';
import {
  AiUnavailableError,
  requireGuidanceAdmin,
} from '@/lib/guidance-value/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

const BATCH_COLUMNS =
  'id, model, key_label, state, request_count, failed_count, error, created_at, applied_at';

// GET  /api/admin/guidance-values/batches
// POST /api/admin/guidance-values/batches  { action: 'queue' | 'check' }
//
// `queue` sends every unfinished notification to the Gemini Batch API at
// half the interactive price; call it again while `remaining` is above
// zero. `check` collects finished batches now instead of waiting for the
// cron.
export async function GET() {
  try {
    await requireGuidanceAdmin();
    const db = supabaseAdmin();
    const [{ data: batches, error }, { count: waiting }] = await Promise.all([
      db
        .from('guidance_value_batches')
        .select(BATCH_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('guidance_value_sources')
        .select('id', { head: true, count: 'exact' })
        .in('status', ['uploaded', 'parsing', 'failed'])
        .is('batch_id', null),
    ]);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      data: { batches: batches ?? [], waiting: waiting ?? 0 },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireGuidanceAdmin();
    const limit = await checkRateLimit(
      `guidanceBatch:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const db = supabaseAdmin();
    try {
      if (body?.action === 'check') {
        return NextResponse.json({ data: await pollGuidanceBatches(db) });
      }
      if (body?.action !== 'queue') {
        return NextResponse.json(
          { error: 'action must be queue or check' },
          { status: 400 }
        );
      }
      return NextResponse.json({ data: await queueGuidanceBatches(db) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outage = classifyAiOutage(message);
      if (outage) {
        const error = new AiUnavailableError(
          message,
          outage === 'rate_limited'
        );
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.code === 'AI_RATE_LIMITED' ? 429 : 503 }
        );
      }
      console.error('[guidance-value] batch failed:', message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
