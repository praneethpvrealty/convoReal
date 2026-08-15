import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { parseActionItemEvents } from '@/lib/calendar/action-item-events';
import { istLocalToUtcIso, resolveByName } from '@/lib/calendar/event-parse';

// POST /api/contacts/[id]/calls/[callId]/create-events
// Turns an analyzed call's action items into calendar entries: items
// with a stated deadline become appointments (reminders flow through
// the existing appointment cron), timeless ones become to-dos. The
// service provider the call was with (e.g. lawyer Vijayasathi) is
// resolved against the liaisons directory — created there if new —
// linked to each appointment, and opted into its reminders, so the
// client AND the lawyer both get nudged.

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId, callId } = await params;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI is not configured on this server.' }, { status: 500 });
    }

    const [{ data: call }, { data: contact }] = await Promise.all([
      ctx.supabase
        .from('contact_call_logs')
        .select('id, action_items, summary, notes, events_created_at')
        .eq('id', callId)
        .eq('contact_id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('contacts')
        .select('id, name')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    if (!call || !contact) {
      return NextResponse.json({ error: 'Call log not found' }, { status: 404 });
    }
    if (call.events_created_at) {
      return NextResponse.json(
        { error: 'Events for this call were already created.', code: 'EVENTS_ALREADY_CREATED' },
        { status: 409 },
      );
    }
    const actionItems = (call.action_items ?? []) as string[];
    if (actionItems.length === 0) {
      return NextResponse.json({ error: 'This call has no action items.' }, { status: 400 });
    }

    const cost = AI_FEATURE_COSTS.action_item_events;
    const burn = await burnCredits(ctx.accountId, 'action_item_events', cost);
    if (!burn.success) {
      return NextResponse.json(
        { error: 'Insufficient credits to create events.', creditsNeeded: cost, upgradeRequired: true },
        { status: 402 },
      );
    }

    let parsed;
    try {
      parsed = await parseActionItemEvents({
        actionItems,
        context: [call.notes, call.summary].filter(Boolean).join('\n') || null,
        contactName: contact.name,
      });
    } catch (apiErr) {
      await refundCredits(ctx.accountId, 'action_item_events', cost);
      console.error('[create-events] Gemini call failed:', apiErr);
      return NextResponse.json(
        { error: 'Could not turn the action items into events. Please try again.' },
        { status: 502 },
      );
    }
    if (parsed.events.length === 0) {
      await refundCredits(ctx.accountId, 'action_item_events', cost);
      return NextResponse.json(
        { error: 'No schedulable events found in the action items.' },
        { status: 422 },
      );
    }

    // Resolve the service provider against the liaisons directory;
    // add them to it when the call named someone new.
    let liaison: { id: string; name: string; phone: string | null } | null = null;
    let liaisonCreated = false;
    if (parsed.liaison_name) {
      const { data: liaisons } = await ctx.supabase
        .from('liaisons')
        .select('id, name, phone')
        .eq('account_id', ctx.accountId)
        .eq('is_active', true);
      liaison = resolveByName(parsed.liaison_name, liaisons || [], (l) => l.name || '');
      if (!liaison) {
        const { data: createdLiaison, error: liaisonErr } = await ctx.supabase
          .from('liaisons')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            name: parsed.liaison_name,
            services: parsed.liaison_role
              ? [{ name: parsed.liaison_role, fee: null, client_charge: null, fee_note: null }]
              : [],
            notes: 'Added from call analysis',
          })
          .select('id, name, phone')
          .single();
        if (liaisonErr) {
          console.error('[create-events] liaison insert failed:', liaisonErr);
        } else {
          liaison = createdLiaison;
          liaisonCreated = true;
        }
      }
    }

    const appointments: { id: string; title: string; start_time: string }[] = [];
    const todos: { id: string; title: string }[] = [];
    for (const event of parsed.events) {
      const startIso = istLocalToUtcIso(event.start_time);
      if (startIso) {
        const { data: appt, error } = await ctx.supabase
          .from('appointments')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            assigned_to: ctx.userId,
            title: event.title,
            description: event.notes,
            event_type: event.event_type,
            start_time: startIso,
            end_time: new Date(new Date(startIso).getTime() + DEFAULT_DURATION_MS).toISOString(),
            status: 'scheduled',
            contact_id: contactId,
            contact_ids: [contactId],
            liaison_id: liaison?.id ?? null,
            remind_liaison: !!liaison,
            source: 'system',
          })
          .select('id, title, start_time')
          .single();
        if (error) throw error;
        appointments.push(appt);
      } else {
        const { data: todo, error } = await ctx.supabase
          .from('todos')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            assigned_to: ctx.userId,
            title: event.title,
            description: event.notes,
            due_date: null,
            priority: 'medium',
            source: 'system',
          })
          .select('id, title')
          .single();
        if (error) throw error;
        todos.push(todo);
      }
    }

    await ctx.supabase
      .from('contact_call_logs')
      // Stamp on a log whose events are already created; the created
      // events are the answer this route returns.
      // eslint-disable-next-line convoreal/supabase-write-guard
      .update({ events_created_at: new Date().toISOString() })
      .eq('id', callId)
      .eq('account_id', ctx.accountId);

    return NextResponse.json(
      {
        data: {
          appointments,
          todos,
          liaison: liaison
            ? { ...liaison, created: liaisonCreated, has_phone: !!liaison.phone }
            : null,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
