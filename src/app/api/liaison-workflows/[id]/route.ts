import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeStages } from '@/lib/liaisons/workflows';

// PUT /api/liaison-workflows/[id] — update a process workflow.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: workflowId } = await params;

    const limit = checkRateLimit(
      `agent:updateLiaisonWorkflow:${ctx.userId}`,
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

    const fieldsToSave = {
      service_name: service_name.trim(),
      description: typeof description === 'string' ? description.trim() || null : null,
      stages: sanitizeStages(stages),
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await ctx.supabase
      .from('liaison_workflows')
      .update(fieldsToSave)
      .eq('id', workflowId);

    if (updateErr) {
      console.error('[PUT /api/liaison-workflows/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update workflow' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: workflowId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
