import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { updateChannelReplyId } from '@/lib/voice/announcements';

// POST /api/contacts/[id]/ask-update-channel — send the contact the
// "how would you like updates?" reply buttons. Interactive messages
// are free-form, so this needs an open 24-hour window; a tap comes
// back as an updch:* control reply that stores the choice
// (src/lib/voice/update-channel-reply.ts).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `agent:askUpdateChannel:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, phone')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (!contact.phone) {
      return NextResponse.json(
        { error: 'This contact has no phone number' },
        { status: 400 }
      );
    }

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('last_customer_message_at')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!isWithinCustomerWindow(conversation?.last_customer_message_at)) {
      return NextResponse.json(
        {
          error:
            'Their 24-hour window is closed — buttons can only be sent after they message you. Ask again once they reply.',
        },
        { status: 409 }
      );
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId: id,
      kind: 'interactive',
      interactiveType: 'buttons',
      senderType: 'user',
      interactiveBody:
        'How would you like to receive updates and reminders from us?',
      interactiveButtons: [
        { id: updateChannelReplyId('whatsapp_text'), title: '💬 Text' },
        { id: updateChannelReplyId('whatsapp_audio'), title: '🎙️ Voice notes' },
        { id: updateChannelReplyId('voice_call'), title: '📞 Phone calls' },
      ],
    });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send' },
        { status: 502 }
      );
    }

    return NextResponse.json({ data: { sent: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
