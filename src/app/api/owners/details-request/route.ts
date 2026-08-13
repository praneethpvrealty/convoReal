import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { resolveConversation } from '@/lib/conversations/resolve';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isWithinCustomerWindow,
  isReengagementError,
} from '@/lib/whatsapp/customer-window';

// POST /api/owners/details-request
// Body: { contact_id: string, property_id?: string, message: string }
//
// Sends the composed owner details request to one Engine contact
// through the account's WhatsApp Business number. Free-form only: this
// is an Engine template, not a Meta one, so a closed 24-hour window
// cannot be papered over with an approved template. That case comes
// back as 409 CUSTOMER_WINDOW_EXPIRED and both surfaces fall back to
// handing the agent the same text on their own WhatsApp.
//
// One route rather than a client-side resolve-then-send so the web
// dialog and the mobile sheet cannot drift on which thread the message
// lands in (§2.8).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** WhatsApp refuses anything longer, and the composer is free text. */
const MAX_MESSAGE_LENGTH = 4096;

export async function POST(request: NextRequest) {
  // Resolved outside the try below, whose catch maps failures onto send
  // errors — a 401/403 must not be reported as "couldn't send".
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const limit = await checkRateLimit(
      `owner-details-request:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      contact_id?: string;
      property_id?: string;
      message?: string;
    } | null;

    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id : '';
    const propertyId =
      typeof body?.property_id === 'string' ? body.property_id : '';
    const message =
      typeof body?.message === 'string' ? body.message.trim() : '';

    if (!UUID_RE.test(contactId) || !message) {
      return NextResponse.json(
        { error: 'contact_id and message are required' },
        { status: 400 }
      );
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }
    if (propertyId && !UUID_RE.test(propertyId)) {
      return NextResponse.json({ error: 'Invalid property' }, { status: 400 });
    }

    // RLS-scoped reads prove both rows belong to the caller's account.
    const [{ data: contact }, { data: property }] = await Promise.all([
      ctx.supabase
        .from('contacts')
        .select('id, phone')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      propertyId
        ? ctx.supabase
            .from('properties')
            .select('id')
            .eq('id', propertyId)
            .eq('account_id', ctx.accountId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (!contact.phone) {
      return NextResponse.json(
        { error: 'This contact has no phone number to message' },
        { status: 400 }
      );
    }
    if (propertyId && !property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const { conversation, error: convError } = await resolveConversation<{
      id: string;
    }>(ctx.supabase, {
      accountId: ctx.accountId,
      contactId,
      userId: ctx.userId,
      columns: 'id',
    });
    if (!conversation) throw convError ?? new Error('Could not open a thread');

    const { data: lastInbound } = await ctx.supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!isWithinCustomerWindow(lastInbound?.created_at ?? null)) {
      return NextResponse.json(
        {
          error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
          code: 'CUSTOMER_WINDOW_EXPIRED',
          conversation_id: conversation.id,
        },
        { status: 409 }
      );
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'agent',
      text: message,
      customDbClient: ctx.supabase,
    });

    if (!result.success) {
      // The window can close between the check and the send. Report that
      // as the same fallback signal rather than a failure, so the caller
      // offers WhatsApp instead of an error the agent cannot act on.
      if (isReengagementError(result.error)) {
        return NextResponse.json(
          {
            error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
            code: 'CUSTOMER_WINDOW_EXPIRED',
            conversation_id: conversation.id,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: result.error || 'Failed to send' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      data: {
        sent: true,
        conversation_id: conversation.id,
        message_id: result.messageId,
      },
    });
  } catch (err) {
    console.error('[owners/details-request] send failed:', err);
    return NextResponse.json(
      { error: 'Failed to send the details request' },
      { status: 500 }
    );
  }
}
