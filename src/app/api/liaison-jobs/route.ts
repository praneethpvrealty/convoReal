import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function sanitizeAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

// POST /api/liaison-jobs — log an engagement with a liaison.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:createLiaisonJob:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      liaison_id, service_name, contact_id, property_id,
      client_charge, liaison_fee, notes,
    } = body;

    // Validation
    if (typeof liaison_id !== 'string' || liaison_id.length === 0) {
      return NextResponse.json({ error: "'liaison_id' is required" }, { status: 400 });
    }
    if (typeof service_name !== 'string' || service_name.trim().length === 0) {
      return NextResponse.json({ error: "'service_name' is required" }, { status: 400 });
    }

    // The FK alone wouldn't stop a job pointing at another tenant's
    // liaison — resolve it through the RLS-scoped client first.
    const { data: liaison } = await ctx.supabase
      .from('liaisons')
      .select('id')
      .eq('id', liaison_id)
      .maybeSingle();
    if (!liaison) {
      return NextResponse.json({ error: 'Liaison not found' }, { status: 404 });
    }

    const jobData = {
      user_id: ctx.userId,
      account_id: ctx.accountId,
      liaison_id,
      service_name: service_name.trim(),
      contact_id: typeof contact_id === 'string' ? contact_id || null : null,
      property_id: typeof property_id === 'string' ? property_id || null : null,
      client_charge: sanitizeAmount(client_charge),
      liaison_fee: sanitizeAmount(liaison_fee),
      notes: typeof notes === 'string' ? notes.trim() || null : null,
    };

    const { data: created, error: insertErr } = await ctx.supabase
      .from('liaison_jobs')
      .insert(jobData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/liaison-jobs] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create job' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
