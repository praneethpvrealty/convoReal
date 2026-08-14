import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { CAMPAIGN_STATUSES, type CampaignStatus } from '@/lib/voice/campaigns';

// GET /api/voice-campaigns/[id] — campaign detail with recipients
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    const { data: campaign } = await ctx.supabase
      .from('voice_campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    const { data: recipients } = await ctx.supabase
      .from('voice_campaign_recipients')
      .select(
        'id, status, attempts, last_attempt_at, call_log_id, qualification, created_at, contact:contacts(id, name, phone, max_budget, pref_budget_max)'
      )
      .eq('account_id', ctx.accountId)
      .eq('campaign_id', id)
      .order('created_at', { ascending: true })
      .limit(2000);

    return NextResponse.json({
      data: { ...campaign, recipients: recipients ?? [] },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/voice-campaigns/[id] — rename, retune, activate/pause
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { data: existing } = await ctx.supabase
      .from('voice_campaigns')
      .select(
        'id, sarvam_agent_id, call_window_start_hour, call_window_end_hour'
      )
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) {
      patch.name = body.name.trim().slice(0, 200);
    }
    if (typeof body.sarvam_agent_id === 'string') {
      patch.sarvam_agent_id = body.sarvam_agent_id.trim() || null;
    }
    if (body.call_window_start_hour !== undefined) {
      patch.call_window_start_hour = Number(body.call_window_start_hour);
    }
    if (body.call_window_end_hour !== undefined) {
      patch.call_window_end_hour = Number(body.call_window_end_hour);
    }
    if (body.max_attempts !== undefined) {
      patch.max_attempts = Number(body.max_attempts);
    }
    if (body.status !== undefined) {
      if (!CAMPAIGN_STATUSES.includes(body.status as CampaignStatus)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      patch.status = body.status;
    }

    const startHour = Number(
      patch.call_window_start_hour ?? existing.call_window_start_hour
    );
    const endHour = Number(
      patch.call_window_end_hour ?? existing.call_window_end_hour
    );
    if (
      !Number.isInteger(startHour) ||
      !Number.isInteger(endHour) ||
      startHour < 0 ||
      startHour > 23 ||
      endHour < 1 ||
      endHour > 24 ||
      startHour >= endHour
    ) {
      return NextResponse.json(
        { error: 'Invalid call window' },
        { status: 400 }
      );
    }
    if (
      patch.max_attempts !== undefined &&
      (!Number.isInteger(patch.max_attempts) ||
        (patch.max_attempts as number) < 1 ||
        (patch.max_attempts as number) > 10)
    ) {
      return NextResponse.json(
        { error: 'Invalid max_attempts' },
        { status: 400 }
      );
    }
    if (
      patch.status === 'active' &&
      !(patch.sarvam_agent_id ?? existing.sarvam_agent_id)
    ) {
      return NextResponse.json(
        { error: 'Set the Sarvam agent id before activating this campaign' },
        { status: 400 }
      );
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error } = await ctx.supabase
      .from('voice_campaigns')
      .update(patch)
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select(
        'id, name, status, sarvam_agent_id, call_window_start_hour, call_window_end_hour, max_attempts'
      )
      .single();
    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message || 'Failed to update campaign' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/voice-campaigns/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: deleted, error } = await ctx.supabase
      .from('voice_campaigns')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
