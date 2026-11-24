import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';
import { setListingStatusFromDeal } from '@/lib/inventory/listing-status-sync';
import { resolveStage } from '@/lib/deals/stage-move';
import { focusNewDealJourney } from '@/lib/deals/new-deal-focus';
import { parseEventSource } from '@/lib/deals/events';
import {
  parseDealParticipants,
  participantsToStore,
  primaryContactId,
} from '@/lib/deals/participants';
import {
  loadParticipantContacts,
  syncDealParticipants,
} from '@/lib/deals/participants-server';
import { actorName } from '@/lib/deals/server';
import {
  LOST_REASON_REQUIRED_ERROR,
  lostReasonMissing,
  parseLostReason,
} from '@/lib/pipelines/lost-reasons';

// POST /api/deals — create a deal and atomically sync the linked property's status.
// Replaces the multi-step client-side writes in deal-form.tsx.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `agent:createDeal:${ctx.userId}`,
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
      // Stage info for property status sync
      stage_name,
    } = body;

    // Validation
    if (typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: "'title' is required" },
        { status: 400 }
      );
    }
    if (typeof pipeline_id !== 'string' || !pipeline_id.trim()) {
      return NextResponse.json(
        { error: "'pipeline_id' is required" },
        { status: 400 }
      );
    }
    if (typeof stage_id !== 'string' || !stage_id.trim()) {
      return NextResponse.json(
        { error: "'stage_id' is required" },
        { status: 400 }
      );
    }

    const lost = parseLostReason(body);
    if (!lost.ok) {
      return NextResponse.json({ error: lost.error }, { status: 400 });
    }
    if (lostReasonMissing(dealStatus, lost.value)) {
      return NextResponse.json(
        { error: LOST_REASON_REQUIRED_ERROR, code: 'LOST_REASON_REQUIRED' },
        { status: 400 }
      );
    }
    const participants = parseDealParticipants(body.participants);
    if (!participants.ok) {
      return NextResponse.json({ error: participants.error }, { status: 400 });
    }
    if (participants.value.length > 0) {
      const known = await loadParticipantContacts(
        ctx.supabase,
        ctx.accountId,
        participants.value.map((p) => p.contact_id)
      );
      if (!known) {
        return NextResponse.json(
          { error: 'One or more contacts are invalid' },
          { status: 400 }
        );
      }
    }
    const appointmentId =
      typeof body.appointment_id === 'string' && body.appointment_id.trim()
        ? body.appointment_id.trim()
        : null;
    if (appointmentId) {
      const { data: appointment } = await ctx.supabase
        .from('appointments')
        .select('id')
        .eq('id', appointmentId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!appointment) {
        return NextResponse.json(
          { error: 'Calendar event not found' },
          { status: 404 }
        );
      }
    }

    const insertData = {
      user_id: ctx.userId,
      account_id: ctx.accountId,
      title: title.trim(),
      value: typeof value === 'number' ? value : 0,
      currency: typeof currency === 'string' ? currency : 'INR',
      contact_id: primaryContactId(
        participants.value,
        typeof contact_id === 'string' && contact_id.trim() ? contact_id : null
      ),
      pipeline_id: pipeline_id.trim(),
      stage_id: stage_id.trim(),
      assigned_to:
        typeof assigned_to === 'string' && assigned_to.trim()
          ? assigned_to.trim()
          : null,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      expected_close_date:
        typeof expected_close_date === 'string'
          ? expected_close_date || null
          : null,
      actual_close_date:
        typeof actual_close_date === 'string'
          ? actual_close_date || null
          : null,
      property_id:
        typeof property_id === 'string' && property_id.trim()
          ? property_id.trim()
          : null,
      brokerage_type:
        typeof brokerage_type === 'string' ? brokerage_type : null,
      brokerage_value:
        typeof brokerage_value === 'number' ? brokerage_value : null,
      brokerage_amount:
        typeof brokerage_amount === 'number' ? brokerage_amount : null,
      status: typeof dealStatus === 'string' ? dealStatus : 'open',
      ...(dealStatus === 'lost' && lost.value ? lost.value : {}),
    };

    const { data: created, error: insertErr } = await ctx.supabase
      .from('deals')
      .insert(insertData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/deals] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create deal' },
        { status: 500 }
      );
    }

    // Sync property status based on stage
    const createdStage = await resolveStage(
      ctx.supabase,
      stage_id.trim(),
      typeof stage_name === 'string' ? stage_name : null
    );
    if (insertData.property_id && createdStage) {
      const propertyStatus =
        propertyStatusForPipelineStage(createdStage) ?? 'Available';
      const synced = await setListingStatusFromDeal(
        ctx.supabase,
        ctx.accountId,
        insertData.property_id,
        propertyStatus
      );
      // The deal is created; a listing that did not follow is a log
      // line, not a failed creation.
      if (!synced) {
        console.warn(
          '[POST /api/deals] Property status not synced:',
          insertData.property_id
        );
      }
    }

    try {
      await focusNewDealJourney(ctx.supabase, {
        accountId: ctx.accountId,
        userId: ctx.userId,
        deal: insertData,
      });
    } catch (focusErr) {
      console.warn('[POST /api/deals] Journey not moved to Focus:', focusErr);
    }

    let participantsSaved = true;
    const stored = participantsToStore(participants.value);
    if (stored.length > 0) {
      const synced = await syncDealParticipants({
        db: ctx.supabase,
        accountId: ctx.accountId,
        dealId: created.id,
        userId: ctx.userId,
        actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
        source: parseEventSource(body.source),
        participants: stored,
      });
      if (!synced.ok) {
        participantsSaved = false;
        console.warn('[POST /api/deals] Participants not saved:', synced.error);
      }
    }

    let appointmentLinked = false;
    if (appointmentId) {
      const { data: linked, error: linkErr } = await ctx.supabase
        .from('appointments')
        .update({ deal_id: created.id })
        .eq('id', appointmentId)
        .eq('account_id', ctx.accountId)
        .select('id');
      appointmentLinked = !linkErr && Boolean(linked?.length);
      if (!appointmentLinked) {
        console.warn('[POST /api/deals] Event not linked:', linkErr);
      }
    }

    return NextResponse.json(
      {
        id: created.id,
        ...(stored.length > 0 ? { participants_saved: participantsSaved } : {}),
        ...(appointmentId ? { appointment_linked: appointmentLinked } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
