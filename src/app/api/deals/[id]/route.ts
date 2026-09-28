import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { ensureClosingRecord } from '@/lib/deals/closing-record';
import { parseEventSource } from '@/lib/deals/events';
import { actorName } from '@/lib/deals/server';
import {
  applyDealStageMove,
  parseBrokerageCapture,
  resolveStage,
  type DealStatus,
} from '@/lib/deals/stage-move';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';
import {
  LOST_REASON_REQUIRED_ERROR,
  lostReasonMissing,
  parseLostReason,
} from '@/lib/pipelines/lost-reasons';
import { deleteDealWithCleanup } from '@/lib/deals/delete-deal';
import { setListingStatusFromDeal } from '@/lib/inventory/listing-status-sync';

type RouteParams = { params: Promise<{ id: string }> };

// PUT /api/deals/[id] — update deal fields + sync property status atomically.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:updateDeal:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const {
      title,
      value,
      currency,
      contact_id,
      pipeline_id,
      stage_id,
      assigned_to,
      notes,
      expected_close_date,
      actual_close_date,
      property_id,
      brokerage_type,
      brokerage_value,
      brokerage_amount,
      status: dealStatus,
      stage_name,
      deal_group_id,
    } = body;

    const updateData: Record<string, unknown> = {};
    if (deal_group_id !== undefined)
      updateData.deal_group_id =
        typeof deal_group_id === 'string' && deal_group_id.trim()
          ? deal_group_id.trim()
          : null;
    if (typeof title === 'string') updateData.title = title.trim();
    if (typeof value === 'number') updateData.value = value;
    if (typeof currency === 'string') updateData.currency = currency;
    if (typeof contact_id === 'string') updateData.contact_id = contact_id;
    if (typeof pipeline_id === 'string')
      updateData.pipeline_id = pipeline_id.trim();
    if (typeof stage_id === 'string') updateData.stage_id = stage_id.trim();
    if (assigned_to !== undefined)
      updateData.assigned_to =
        typeof assigned_to === 'string' && assigned_to.trim()
          ? assigned_to.trim()
          : null;
    if (notes !== undefined)
      updateData.notes =
        typeof notes === 'string' ? notes.trim() || null : null;
    if (expected_close_date !== undefined)
      updateData.expected_close_date =
        typeof expected_close_date === 'string'
          ? expected_close_date || null
          : null;
    if (actual_close_date !== undefined)
      updateData.actual_close_date =
        typeof actual_close_date === 'string'
          ? actual_close_date || null
          : null;
    if (property_id !== undefined)
      updateData.property_id =
        typeof property_id === 'string' && property_id.trim()
          ? property_id.trim()
          : null;
    if (brokerage_type !== undefined)
      updateData.brokerage_type =
        typeof brokerage_type === 'string' ? brokerage_type : null;
    if (typeof brokerage_value === 'number')
      updateData.brokerage_value = brokerage_value;
    if (typeof brokerage_amount === 'number')
      updateData.brokerage_amount = brokerage_amount;
    if (typeof dealStatus === 'string') updateData.status = dealStatus;
    const lost = parseLostReason(body);
    if (!lost.ok) {
      return NextResponse.json({ error: lost.error }, { status: 400 });
    }
    if (dealStatus === 'lost' && lost.value) {
      updateData.lost_reason = lost.value.lost_reason;
      updateData.lost_note = lost.value.lost_note;
    } else if (lostReasonMissing(dealStatus, lost.value)) {
      const { data: current } = await ctx.supabase
        .from('deals')
        .select('status')
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (current?.status !== 'lost') {
        return NextResponse.json(
          { error: LOST_REASON_REQUIRED_ERROR, code: 'LOST_REASON_REQUIRED' },
          { status: 400 }
        );
      }
    }

    let previousPropertyId: string | null = null;
    if (property_id !== undefined) {
      const { data: previous, error: previousErr } = await ctx.supabase
        .from('deals')
        .select('property_id')
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (previousErr) {
        console.error('[PUT /api/deals/[id]] Deal lookup:', previousErr);
        return NextResponse.json(
          {
            error:
              'Could not read this deal, so it was not updated. Try again.',
          },
          { status: 500 }
        );
      }
      if (!previous) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      }
      previousPropertyId =
        (previous as { property_id: string | null }).property_id ?? null;
    }

    const { data: updated, error: updateErr } = await (property_id === undefined
      ? ctx.supabase
          .from('deals')
          .update(updateData)
          .eq('id', dealId)
          .select('id')
      : previousPropertyId
        ? ctx.supabase
            .from('deals')
            .update(updateData)
            .eq('id', dealId)
            .eq('property_id', previousPropertyId)
            .select('id')
        : ctx.supabase
            .from('deals')
            .update(updateData)
            .eq('id', dealId)
            .is('property_id', null)
            .select('id'));

    if (!updateErr && !updated?.length) {
      return property_id !== undefined
        ? NextResponse.json(
            {
              error:
                'This deal was changed by someone else while you were editing it. Reload it and try again.',
              code: 'DEAL_CHANGED',
            },
            { status: 409 }
          )
        : NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    if (updateErr) {
      console.error('[PUT /api/deals/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update deal' },
        { status: 500 }
      );
    }

    const movedStage =
      typeof stage_id === 'string'
        ? await resolveStage(
            ctx.supabase,
            stage_id,
            typeof stage_name === 'string' ? stage_name : null
          )
        : null;
    if (movedStage) {
      const record = await ensureClosingRecord({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId,
        stage: movedStage,
        actorId: ctx.userId,
        actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
        source: parseEventSource(body.source),
      });
      if (record.error) {
        return NextResponse.json(
          {
            error: `Stage moved but the closing record could not be started: ${record.error}`,
            code: 'CLOSING_RECORD_FAILED',
          },
          { status: 500 }
        );
      }
    }

    // Sync property status based on stage
    const effectivePropertyId =
      typeof property_id === 'string' && property_id.trim()
        ? property_id.trim()
        : null;
    if (effectivePropertyId && movedStage) {
      const propertyStatus =
        propertyStatusForPipelineStage(movedStage) ?? 'Available';
      const synced = await setListingStatusFromDeal(
        ctx.supabase,
        ctx.accountId,
        effectivePropertyId,
        propertyStatus
      );
      // The deal is already saved; a listing that did not follow is
      // worth a line in the log, not a failed request.
      if (!synced) {
        console.warn(
          '[PUT /api/deals/[id]] Property status not synced:',
          effectivePropertyId
        );
      }
    }

    if (previousPropertyId && previousPropertyId !== updateData.property_id) {
      const released = await setListingStatusFromDeal(
        ctx.supabase,
        ctx.accountId,
        previousPropertyId,
        'Available'
      );
      if (!released) {
        console.warn(
          '[PUT /api/deals/[id]] Previous property not re-synced:',
          previousPropertyId
        );
      }
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

    const limit = await checkRateLimit(
      `agent:dealStatus:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { status, target_stage_id, property_id, current_stage_name } = body;

    if (
      typeof status !== 'string' ||
      !['won', 'lost', 'open'].includes(status)
    ) {
      return NextResponse.json(
        { error: "'status' must be 'won', 'lost', or 'open'" },
        { status: 400 }
      );
    }

    const brokerage = parseBrokerageCapture(body);
    if (!brokerage.ok) {
      return NextResponse.json({ error: brokerage.error }, { status: 400 });
    }
    const lost = parseLostReason(body);
    if (!lost.ok) {
      return NextResponse.json({ error: lost.error }, { status: 400 });
    }
    if (lostReasonMissing(status, lost.value)) {
      return NextResponse.json(
        { error: LOST_REASON_REQUIRED_ERROR, code: 'LOST_REASON_REQUIRED' },
        { status: 400 }
      );
    }

    const moved = await applyDealStageMove(ctx, {
      dealId,
      status: status as DealStatus,
      targetStageId:
        typeof target_stage_id === 'string' && target_stage_id.trim()
          ? target_stage_id.trim()
          : null,
      stageName:
        typeof current_stage_name === 'string' ? current_stage_name : null,
      propertyId:
        typeof property_id === 'string' && property_id.trim()
          ? property_id.trim()
          : null,
      brokerage: brokerage.value,
      lost: lost.value,
      source: parseEventSource(body.source),
    });
    if (!moved.ok) {
      return NextResponse.json(
        { error: moved.error, ...(moved.code ? { code: moved.code } : {}) },
        { status: moved.status }
      );
    }

    return NextResponse.json({ id: dealId, status });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/deals/[id] — delete a deal and reset linked property status.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:deleteDeal:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const result = await deleteDealWithCleanup(ctx, dealId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
