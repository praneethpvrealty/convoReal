import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { isReengagementError } from '@/lib/whatsapp/customer-window';
import { stripDeliveryFailure } from '@/lib/whatsapp/delivery-failure';

// POST /api/whatsapp/forward
// Body: { message_id: string, contact_ids: string[] }
//
// Sends a message's text on to other contacts from the same business
// number. Each recipient gets a normal free-form message in their own
// thread — the dispatcher resolves or creates that conversation and
// enforces the 24-hour window, so a contact who hasn't written in a day
// comes back as `window_closed` rather than a silent failure.
//
// Text only: outgoing media rows carry a storage URL and inbound ones a
// Meta media id, neither of which can be re-sent without re-uploading.

/** Recipients per call. Forwarding is a one-to-a-few action; anything
 *  larger belongs in a broadcast, which has its own consent handling. */
const MAX_RECIPIENTS = 10;

export async function POST(request: Request) {
  // Resolved outside the main try so an auth failure is reported as
  // 401/403 rather than folded into a send error.
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('agent');
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const limit = checkRateLimit(`forward:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      message_id?: string;
      contact_ids?: unknown;
    } | null;

    const messageId =
      typeof body?.message_id === 'string' ? body.message_id : '';
    const contactIds = Array.isArray(body?.contact_ids)
      ? [
          ...new Set(
            body.contact_ids.filter(
              (id): id is string => typeof id === 'string' && !!id
            )
          ),
        ]
      : [];

    if (!messageId || contactIds.length === 0) {
      return NextResponse.json(
        { error: 'message_id and at least one contact_id are required' },
        { status: 400 }
      );
    }
    if (contactIds.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        {
          error: `Forward reaches up to ${MAX_RECIPIENTS} contacts at a time — use a broadcast for a larger list.`,
        },
        { status: 400 }
      );
    }

    // RLS-scoped read: proves the message is one the caller can see
    // before its text is sent anywhere else.
    const { data: message, error: messageError } = await ctx.supabase
      .from('messages')
      .select('id, content_text')
      .eq('id', messageId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // A failed message carries the webhook's delivery-failure note in its
    // body — forwarding that would send our own error report on.
    const text = stripDeliveryFailure(message.content_text as string | null);
    if (!text) {
      return NextResponse.json(
        { error: 'This message has no text to forward.' },
        { status: 400 }
      );
    }

    const { data: contactRows, error: contactsError } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', ctx.accountId)
      .in('id', contactIds);
    if (contactsError) throw contactsError;

    const contacts = (contactRows ?? []) as {
      id: string;
      name: string | null;
      phone: string;
    }[];
    if (contacts.length === 0) {
      return NextResponse.json(
        { error: 'No matching contacts' },
        { status: 404 }
      );
    }

    // Sequential on purpose: each send resolves or creates a
    // conversation, and the recipient count is small by construction.
    const results = [];
    for (const contact of contacts) {
      const res = await sendWhatsAppMessageAndPersist({
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId: contact.id,
        kind: 'text',
        senderType: 'agent',
        text,
      });
      results.push({
        contact_id: contact.id,
        name: contact.name || contact.phone,
        sent: res.success,
        ...(res.success
          ? {}
          : {
              window_closed: isReengagementError(res.error),
              error: res.error || 'Failed to send',
            }),
      });
    }

    return NextResponse.json({ data: { results } });
  } catch (error) {
    console.error('[whatsapp/forward] failed:', error);
    return NextResponse.json(
      { error: 'Failed to forward message' },
      { status: 500 }
    );
  }
}
