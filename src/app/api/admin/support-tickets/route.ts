// ============================================================
// /api/admin/support-tickets — cross-tenant help desk.
//
//   GET   — every account's tickets, newest first.
//   PATCH — assign to the caller, answer (and deliver over the
//           requester's channel), or close.
//
// Super-admin only, service-role client — same posture as
// /api/admin/bug-reports. Answer delivery: WhatsApp goes out from
// the PLATFORM sender (resolvePlatformSender), email via Resend.
// Delivery is best-effort and recorded on the ticket
// (answer_sent_via), so a failed send is visible instead of silent.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTransactionalEmail } from '@/lib/email';
import {
  buildTicketReplyEmail,
  buildTicketReplyText,
} from '@/lib/support/tickets';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendPlatformTemplate } from '@/lib/whatsapp/platform-sender';

async function requireSuperAdmin(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, body: { error: 'Unauthorized' } };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profile?.role !== 'super_admin') {
    return { ok: false as const, status: 403, body: { error: 'Forbidden' } };
  }
  return { ok: true as const, userId: user.id };
}

export async function GET() {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data, error } = await supabaseAdmin()
    .from('support_tickets')
    .select(
      'id, reference, question, helper_reply, coverage, platform, pathname, preferred_channel, contact_phone, contact_email, status, assigned_to_user_id, answer, answered_at, answer_sent_via, created_at, account_id, accounts(name)'
    )
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    console.error('[GET /api/admin/support-tickets] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to load support tickets' },
      { status: 500 }
    );
  }

  return NextResponse.json({ tickets: data ?? [] });
}

interface TicketRow {
  id: string;
  reference: string;
  question: string;
  preferred_channel: 'whatsapp' | 'email';
  contact_phone: string | null;
  contact_email: string | null;
  status: string;
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  let payload: { id?: unknown; action?: unknown; answer?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof payload.id !== 'string' || !payload.id) {
    return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: ticket } = await admin
    .from('support_tickets')
    .select(
      'id, reference, question, preferred_channel, contact_phone, contact_email, status'
    )
    .eq('id', payload.id)
    .maybeSingle<TicketRow>();
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  if (payload.action === 'assign') {
    const { error } = await admin
      .from('support_tickets')
      .update({
        status: 'assigned',
        assigned_to_user_id: guard.userId,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', ticket.id);
    if (error) {
      console.error('[PATCH /api/admin/support-tickets] assign error:', error);
      return NextResponse.json({ error: 'Failed to assign' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (payload.action === 'close') {
    const { error } = await admin
      .from('support_tickets')
      .update({ status: 'closed' })
      .eq('id', ticket.id);
    if (error) {
      console.error('[PATCH /api/admin/support-tickets] close error:', error);
      return NextResponse.json({ error: 'Failed to close' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (payload.action === 'answer') {
    const answer =
      typeof payload.answer === 'string'
        ? payload.answer.trim().slice(0, 5_000)
        : '';
    if (!answer) {
      return NextResponse.json({ error: 'Write an answer' }, { status: 400 });
    }

    const sentVia: string[] = [];

    if (ticket.preferred_channel === 'whatsapp' && ticket.contact_phone) {
      const result = await sendPlatformTemplate(admin, {
        toPhone: ticket.contact_phone,
        templateName: 'support_ticket_reply',
        params: [ticket.reference, answer],
        fallbackText: buildTicketReplyText(ticket.reference, answer),
      });
      if (result.sent) sentVia.push('whatsapp');
    }

    if (ticket.preferred_channel === 'email' && ticket.contact_email) {
      const email = buildTicketReplyEmail({
        reference: ticket.reference,
        question: ticket.question,
        answer,
      });
      const result = await sendTransactionalEmail({
        to: ticket.contact_email,
        ...email,
      });
      if (result.success) sentVia.push('email');
    }

    const { error } = await admin
      .from('support_tickets')
      .update({
        status: 'answered',
        answer,
        answered_by_user_id: guard.userId,
        answered_at: new Date().toISOString(),
        answer_sent_via: sentVia,
      })
      .eq('id', ticket.id);
    if (error) {
      console.error('[PATCH /api/admin/support-tickets] answer error:', error);
      return NextResponse.json(
        { error: 'Failed to save the answer' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, sentVia });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
