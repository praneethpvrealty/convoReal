import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import {
  loadTemplateForContact,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';
import {
  CALL_UPDATE_TEMPLATE_NAME,
  buildCallUpdateParams,
} from '@/lib/whatsapp/call-update-template';
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isReengagementError,
  isWithinCustomerWindow,
} from '@/lib/whatsapp/customer-window';
import type { MessageTemplate } from '@/types';

// POST /api/contacts/[id]/calls/[callId]/send-update
//
// Sends the reviewed AI call-update draft to the contact on WhatsApp.
// Body may carry the edited text ({ message }) so review edits and the
// send are one tap; it falls back to the stored draft.
//
// The `call_update` template is the default route, always — not a
// fallback for a shut window. An agent finishing a call is usually
// outside the 24-hour service window (the contact last messaged days
// ago), so free-form text is refused far more often than it lands;
// routing every update through the approved Utility template makes the
// same send work either way. Free-form remains as the fallback for
// accounts whose template Meta has not approved yet, and it only works
// inside the window — outside it the 409 tells the client to offer the
// agent's own WhatsApp instead of the message dying at Meta.

function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId, callId } = await params;

    const limit = await checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { message?: string } | null;

    const [{ data: call }, { data: contact }] = await Promise.all([
      ctx.supabase
        .from('contact_call_logs')
        .select('id, update_draft')
        .eq('id', callId)
        .eq('contact_id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('contacts')
        .select('name')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    if (!call) {
      return NextResponse.json({ error: 'Call log not found' }, { status: 404 });
    }

    const message = (body?.message ?? call.update_draft ?? '').trim();
    if (!message) {
      return NextResponse.json({ error: 'Nothing to send — the update draft is empty.' }, { status: 400 });
    }

    const [{ data: conversation }, templateRow] = await Promise.all([
      ctx.supabase
        .from('conversations')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      // Every language variant, not just the newest row — the client
      // this update is for may not read English.
      loadTemplateForContact<MessageTemplate>(ctx.supabase, {
        accountId: ctx.accountId,
        contactId,
        names: [CALL_UPDATE_TEMPLATE_NAME],
      }),
    ]);
    const template = templateRow.template;
    if (templateRow.fellBack) {
      warnLanguageFallback(
        'call-update',
        ctx.accountId,
        templateRow.language,
        template,
      );
    }

    // 1. The default route: the approved template, in or out of the window.
    if (template?.status === 'APPROVED') {
      const bodyParams = truncateParametersToBudget(template.body_text, [
        ...buildCallUpdateParams(contact?.name, ctx.account.name, message),
      ]);
      const res = await sendWhatsAppMessageAndPersist({
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId,
        conversationId: conversation?.id,
        kind: 'template',
        senderType: 'agent',
        templateName: template.name,
        templateLanguage: template.language || 'en_US',
        templateParams: bodyParams,
        messageParams: { body: bodyParams },
        templateRow: template,
        text: resolveTemplateBodyText(template.body_text, bodyParams),
      });
      if (res.success) {
        return NextResponse.json({
          data: await markSent(ctx, callId, contactId, message, conversation?.id, 'template'),
        });
      }
      console.error('[send-update] call_update template send failed:', res.error);
    }

    // 2. Fallback: free-form, which only Meta's open window allows.
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
        {
          error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
          code: 'CUSTOMER_WINDOW_EXPIRED',
          template_status: template?.status ?? null,
        },
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
          {
            error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
            code: 'CUSTOMER_WINDOW_EXPIRED',
            template_status: template?.status ?? null,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: res.error || 'Failed to send update' }, { status: 502 });
    }

    return NextResponse.json({
      data: await markSent(ctx, callId, contactId, message, conversation?.id, 'freeform'),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function markSent(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  callId: string,
  contactId: string,
  message: string,
  conversationId: string | undefined,
  channel: 'template' | 'freeform',
) {
  const { data: updated, error } = await ctx.supabase
    .from('contact_call_logs')
    .update({ update_draft: message, update_sent_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('contact_id', contactId)
    .eq('account_id', ctx.accountId)
    .select()
    .maybeSingle();
  if (error) {
    // The message already reached the contact — surface the call row
    // as sent even if the bookkeeping write failed.
    console.error('[send-update] failed to mark call log sent:', error.message);
  }
  return { sent: true, channel, conversation_id: conversationId ?? null, call: updated ?? null };
}
