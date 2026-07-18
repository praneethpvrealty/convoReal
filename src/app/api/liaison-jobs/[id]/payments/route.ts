import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/liaison-jobs/[id]/payments — record cash movement on a job.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: jobId } = await params;

    const limit = checkRateLimit(
      `agent:createLiaisonPayment:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { direction, amount, paid_on, note } = body;

    // Validation
    if (direction !== 'in' && direction !== 'out') {
      return NextResponse.json(
        { error: "'direction' must be 'in' or 'out'" },
        { status: 400 },
      );
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "'amount' must be a positive number" },
        { status: 400 },
      );
    }

    // Resolve the job through the RLS-scoped client so a payment can't
    // be attached to another tenant's job.
    const { data: job } = await ctx.supabase
      .from('liaison_jobs')
      .select('id')
      .eq('id', jobId)
      .maybeSingle();
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const paymentData = {
      account_id: ctx.accountId,
      job_id: jobId,
      user_id: ctx.userId,
      direction,
      amount,
      // DATE column; defaults to today when the client omits it.
      ...(typeof paid_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paid_on)
        ? { paid_on }
        : {}),
      note: typeof note === 'string' ? note.trim() || null : null,
    };

    const { data: created, error: insertErr } = await ctx.supabase
      .from('liaison_job_payments')
      .insert(paymentData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/liaison-jobs/[id]/payments] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to record payment' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
