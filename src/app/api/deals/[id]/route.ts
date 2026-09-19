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
import { brokerageAmount } from '@/lib/pipelines/brokerage';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';
import { DEAL_DOCUMENT_BUCKET } from '@/lib/invoices/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

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

    const { data: updated, error: updateErr } = await ctx.supabase
      .from('deals')
      .update(updateData)
      .eq('id', dealId)
      .select('id');

    if (!updateErr && !updated?.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    if (updateErr) {
      console.error('[PUT /api/deals/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update deal' },
        { status: 500 }
      );
    }

    if (typeof stage_id === 'string' && typeof stage_name === 'string') {
      const record = await ensureClosingRecord({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId,
        stageName: stage_name,
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
    if (effectivePropertyId && typeof stage_name === 'string') {
      const propertyStatus =
        propertyStatusForPipelineStage(stage_name) ?? 'Available';
      const { data: synced } = await ctx.supabase
        .from('properties')
        .update({ status: propertyStatus })
        .eq('id', effectivePropertyId)
        .select('id');
      // The deal is already saved; a listing that did not follow is
      // worth a line in the log, not a failed request.
      if (!synced?.length) {
        console.warn(
          '[PUT /api/deals/[id]] Property status not synced:',
          effectivePropertyId
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

    const {
      status,
      target_stage_id,
      property_id,
      current_stage_name,
      brokerage_type,
      brokerage_value,
    } = body;

    if (
      typeof status !== 'string' ||
      !['won', 'lost', 'open'].includes(status)
    ) {
      return NextResponse.json(
        { error: "'status' must be 'won', 'lost', or 'open'" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = { status };
    if (typeof target_stage_id === 'string' && target_stage_id.trim()) {
      updateData.stage_id = target_stage_id.trim();
    }

    if (brokerage_type !== undefined || brokerage_value !== undefined) {
      if (
        (brokerage_type !== 'percentage' && brokerage_type !== 'fixed') ||
        typeof brokerage_value !== 'number' ||
        !Number.isFinite(brokerage_value) ||
        brokerage_value <= 0
      ) {
        return NextResponse.json(
          {
            error:
              "'brokerage_type' must be 'percentage' or 'fixed' with a positive 'brokerage_value'",
          },
          { status: 400 }
        );
      }
      const { data: current } = await ctx.supabase
        .from('deals')
        .select('value')
        .eq('id', dealId)
        .maybeSingle();
      if (!current) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      }
      updateData.brokerage_type = brokerage_type;
      updateData.brokerage_value = brokerage_value;
      updateData.brokerage_amount = brokerageAmount({
        dealValue: current.value,
        type: brokerage_type,
        value: brokerage_value,
      });
    }

    const { data: updated, error: updateErr } = await ctx.supabase
      .from('deals')
      .update(updateData)
      .eq('id', dealId)
      .select('id');

    if (!updateErr && !updated?.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    if (updateErr) {
      console.error('[PATCH /api/deals/[id]] Status update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update deal status' },
        { status: 500 }
      );
    }

    if (updateData.stage_id && typeof current_stage_name === 'string') {
      const record = await ensureClosingRecord({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId,
        stageName: current_stage_name,
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

    // Sync property status
    const propId =
      typeof property_id === 'string' && property_id.trim()
        ? property_id.trim()
        : null;
    if (propId) {
      const propertyStatus =
        typeof current_stage_name === 'string'
          ? (propertyStatusForPipelineStage(current_stage_name) ?? 'Available')
          : status === 'won'
            ? 'Sold'
            : 'Available';
      const { data: synced } = await ctx.supabase
        .from('properties')
        .update({ status: propertyStatus })
        .eq('id', propId)
        .select('id');
      if (!synced?.length) {
        console.warn(
          '[PATCH /api/deals/[id]] Property status not synced:',
          propId
        );
      }
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

    // Fetch the deal first to get the property_id and the invoice
    // objects for cleanup
    const { data: deal } = await ctx.supabase
      .from('deals')
      .select('property_id')
      .eq('id', dealId)
      .single();

    // Read before the delete: deal_documents cascades with the deal, so
    // after it runs there is nothing left naming these objects.
    const { data: docs, error: docsErr } = await ctx.supabase
      .from('deal_documents')
      .select('storage_path')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId);

    // Swallowing this would delete the deal, cascade the rows away and
    // report success while the files — Aadhaars among them — stayed in
    // the bucket with nothing left naming them. Stop instead: the deal
    // is still here to try again.
    if (docsErr) {
      console.error('[DELETE /api/deals/[id]] Document lookup:', docsErr);
      return NextResponse.json(
        {
          error:
            "Could not read this deal's documents, so it was not deleted. Try again.",
        },
        { status: 500 }
      );
    }

    const { data: deleted, error: deleteErr } = await ctx.supabase
      .from('deals')
      .delete()
      .eq('id', dealId)
      .select('id');

    if (deleteErr) {
      console.error('[DELETE /api/deals/[id]] Delete error:', deleteErr);
      return NextResponse.json(
        { error: deleteErr.message ?? 'Failed to delete deal' },
        { status: 500 }
      );
    }

    if (!deleted?.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // deal_documents rows cascade with the deal, but the objects they
    // pointed at do not: a file left in a private bucket with no row
    // naming it is nobody's to find or delete later. Paths are read
    // before the cascade and scoped to this account and deal.
    const orphaned = (docs ?? [])
      .map((doc) => doc.storage_path)
      .filter(
        (path): path is string =>
          typeof path === 'string' &&
          !path.includes('..') &&
          path.startsWith(`${DEAL_DOCUMENT_BUCKET}/${ctx.accountId}/${dealId}/`)
      )
      .map((path) => path.slice(DEAL_DOCUMENT_BUCKET.length + 1));

    if (orphaned.length > 0) {
      const { error: removeErr } = await supabaseAdmin()
        .storage.from(DEAL_DOCUMENT_BUCKET)
        .remove(orphaned);
      if (removeErr) {
        console.warn(
          '[DELETE /api/deals/[id]] Deal document objects not removed:',
          dealId
        );
      }
    }

    // Reset property status to Available if it was linked
    if (deal?.property_id) {
      const { data: released } = await ctx.supabase
        .from('properties')
        .update({ status: 'Available' })
        .eq('id', deal.property_id)
        .select('id');
      if (!released?.length) {
        console.warn(
          '[DELETE /api/deals/[id]] Property not released:',
          deal.property_id
        );
      }
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
