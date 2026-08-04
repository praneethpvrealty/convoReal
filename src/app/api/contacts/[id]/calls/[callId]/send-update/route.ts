import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isReengagementError,
  isWithinCustomerWindow,
} from '@/lib/whatsapp/customer-window';

// POST /api/contacts/[id]/calls/[callId]/send-update
// Sends the reviewed AI call-update draft to the contact on
// WhatsApp. Body may carry the edited text ({ message }) so review
// edits and the send are one tap; it falls back to the stored
// draft. Free-form only — outside the 24-hour service window the
// send is refused with CUSTOMER_WINDOW_EXPIRED so the client can
// point the agent at the inbox's template path instead of the
// message dying asynchronously at Meta.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId, callId } = await params;

    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { message?: string } | null;

    const { data: call } = await ctx.supabase
      .from('contact_call_logs')
      .select('id, update_draft')
      .eq('id', callId)
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!call) {
      return NextResponse.json({ error: 'Call log not found' }, { status: 404 });
    }

    const message = (body?.message ?? call.update_draft ?? '').trim();
    if (!message) {
      return NextResponse.json({ error: 'Nothing to send — the update draft is empty.' }, { status: 400 });
    }

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    let lastCustomerMessageAt: string | null = null;
    if (conversation) {
      const { data: lastCustomerMsg } = await ctx.supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lastCustomerMessageAt = lastCustomerMsg?.created_at ?? null;
    }

    if (!isWithinCustomerWindow(lastCustomerMessageAt)) {
      return NextResponse.json(
        { error: CUSTOMER_WINDOW_EXPIRED_MESSAGE, code: 'CUSTOMER_WINDOW_EXPIRED' },
        { status: 409 },
      );
    }

    const res = await sendWhatsAppMessageAndPersist({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      conversationId: conversation?.id,
      kind: 'text',
      text: message,
      senderType: 'agent',
    });
    if (!res.success) {
      if (isReengagementError(res.error)) {
        return NextResponse.json(
          { error: CUSTOMER_WINDOW_EXPIRED_MESSAGE, code: 'CUSTOMER_WINDOW_EXPIRED' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: res.error || 'Failed to send update' }, { status: 502 });
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('contact_call_logs')
      .update({ update_draft: message, update_sent_at: new Date().toISOString() })
      .eq('id', callId)
      .eq('account_id', ctx.accountId)
      .select()
      .maybeSingle();
    if (updateError) {
      // The message already reached the contact — surface the call row
      // as sent even if the bookkeeping write failed.
      console.error('[send-update] failed to mark call log sent:', updateError.message);
    }

    return NextResponse.json({
      data: {
        sent: true,
        conversation_id: conversation?.id ?? null,
        call: updated ?? null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
