import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const STATUSES = ['open', 'completed', 'cancelled'] as const;

function sanitizeAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

// PUT /api/liaison-jobs/[id] — update a job (details and/or status).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: jobId } = await params;

    const limit = checkRateLimit(
      `agent:updateLiaisonJob:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      service_name, contact_id, property_id,
      client_charge, liaison_fee, notes, status,
    } = body;

    // Validation
    if (typeof service_name !== 'string' || service_name.trim().length === 0) {
      return NextResponse.json({ error: "'service_name' is required" }, { status: 400 });
    }
    const nextStatus = typeof status === 'string' && (STATUSES as readonly string[]).includes(status)
      ? (status as (typeof STATUSES)[number])
      : 'open';

    const fieldsToSave = {
      service_name: service_name.trim(),
      contact_id: typeof contact_id === 'string' ? contact_id || null : null,
      property_id: typeof property_id === 'string' ? property_id || null : null,
      client_charge: sanitizeAmount(client_charge),
      liaison_fee: sanitizeAmount(liaison_fee),
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await ctx.supabase
      .from('liaison_jobs')
      .update(fieldsToSave)
      .eq('id', jobId);

    if (updateErr) {
      console.error('[PUT /api/liaison-jobs/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update job' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: jobId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
