import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeStages } from '@/lib/liaisons/workflows';

// POST /api/liaison-workflows — define a client-shareable process workflow.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:createLiaisonWorkflow:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { service_name, description, stages } = body;

    // Validation
    if (typeof service_name !== 'string' || service_name.trim().length === 0) {
      return NextResponse.json({ error: "'service_name' is required" }, { status: 400 });
    }

    const workflowData = {
      user_id: ctx.userId,
      account_id: ctx.accountId,
      service_name: service_name.trim(),
      description: typeof description === 'string' ? description.trim() || null : null,
      stages: sanitizeStages(stages),
    };

    const { data: created, error: insertErr } = await ctx.supabase
      .from('liaison_workflows')
      .insert(workflowData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/liaison-workflows] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create workflow' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
