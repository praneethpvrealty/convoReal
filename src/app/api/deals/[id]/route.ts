import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

// PUT /api/deals/[id] — update deal fields + sync property status atomically.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = checkRateLimit(
      `agent:updateDeal:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      title, value, currency, contact_id, pipeline_id,
      stage_id, assigned_to, notes, expected_close_date,
      property_id, brokerage_type, brokerage_value,
      brokerage_amount, status: dealStatus,
      stage_name,
    } = body;

    const updateData: Record<string, unknown> = {};
    if (typeof title === 'string') updateData.title = title.trim();
    if (typeof value === 'number') updateData.value = value;
    if (typeof currency === 'string') updateData.currency = currency;
    if (typeof contact_id === 'string') updateData.contact_id = contact_id;
    if (typeof pipeline_id === 'string') updateData.pipeline_id = pipeline_id.trim();
    if (typeof stage_id === 'string') updateData.stage_id = stage_id.trim();
    if (assigned_to !== undefined) updateData.assigned_to = typeof assigned_to === 'string' && assigned_to.trim() ? assigned_to.trim() : null;
    if (notes !== undefined) updateData.notes = typeof notes === 'string' ? notes.trim() || null : null;
    if (expected_close_date !== undefined) updateData.expected_close_date = typeof expected_close_date === 'string' ? expected_close_date || null : null;
    if (property_id !== undefined) updateData.property_id = typeof property_id === 'string' && property_id.trim() ? property_id.trim() : null;
    if (brokerage_type !== undefined) updateData.brokerage_type = typeof brokerage_type === 'string' ? brokerage_type : null;
    if (typeof brokerage_value === 'number') updateData.brokerage_value = brokerage_value;
    if (typeof brokerage_amount === 'number') updateData.brokerage_amount = brokerage_amount;
    if (typeof dealStatus === 'string') updateData.status = dealStatus;

    const { error: updateErr } = await ctx.supabase
      .from('deals')
      .update(updateData)
      .eq('id', dealId);

    if (updateErr) {
      console.error('[PUT /api/deals/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update deal' },
        { status: 500 },
      );
    }

    // Sync property status based on stage
    const effectivePropertyId = typeof property_id === 'string' && property_id.trim() ? property_id.trim() : null;
    if (effectivePropertyId && typeof stage_name === 'string') {
      let propertyStatus = 'Available';
      if (stage_name === 'Negotiation/Token') {
        propertyStatus = 'Under Contract';
      } else if (stage_name === 'Closed Won') {
        propertyStatus = 'Sold';
      }
      await ctx.supabase
        .from('properties')
        .update({ status: propertyStatus })
        .eq('id', effectivePropertyId);
    }

    return NextResponse.json({ id: dealId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/deals/[id] — status change (won/lost/reopen) + atomic property sync.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = checkRateLimit(
      `agent:dealStatus:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { status, target_stage_id, property_id, current_stage_name } = body;

    if (typeof status !== 'string' || !['won', 'lost', 'open'].includes(status)) {
      return NextResponse.json(
        { error: "'status' must be 'won', 'lost', or 'open'" },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = { status };
    if (typeof target_stage_id === 'string' && target_stage_id.trim()) {
      updateData.stage_id = target_stage_id.trim();
    }

    const { error: updateErr } = await ctx.supabase
      .from('deals')
      .update(updateData)
      .eq('id', dealId);

    if (updateErr) {
      console.error('[PATCH /api/deals/[id]] Status update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update deal status' },
        { status: 500 },
      );
    }

    // Sync property status
    const propId = typeof property_id === 'string' && property_id.trim() ? property_id.trim() : null;
    if (propId) {
      let propertyStatus = 'Available';
      if (status === 'won') {
        propertyStatus = 'Sold';
      } else if (status === 'lost') {
        propertyStatus = 'Available';
      } else {
        // Reopened — check current stage
        if (typeof current_stage_name === 'string' && current_stage_name === 'Negotiation/Token') {
          propertyStatus = 'Under Contract';
        }
      }
      await ctx.supabase
        .from('properties')
        .update({ status: propertyStatus })
        .eq('id', propId);
    }

    return NextResponse.json({ id: dealId, status });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id] — delete a deal and reset linked property status.
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = checkRateLimit(
      `agent:deleteDeal:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Fetch the deal first to get the property_id for cleanup
    const { data: deal } = await ctx.supabase
      .from('deals')
      .select('property_id')
      .eq('id', dealId)
      .single();

    const { error: deleteErr } = await ctx.supabase
      .from('deals')
      .delete()
      .eq('id', dealId);

    if (deleteErr) {
      console.error('[DELETE /api/deals/[id]] Delete error:', deleteErr);
      return NextResponse.json(
        { error: deleteErr.message ?? 'Failed to delete deal' },
        { status: 500 },
      );
    }

    // Reset property status to Available if it was linked
    if (deal?.property_id) {
      await ctx.supabase
        .from('properties')
        .update({ status: 'Available' })
        .eq('id', deal.property_id);
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
