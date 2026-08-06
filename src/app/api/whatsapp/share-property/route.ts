import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import { isReengagementError } from '@/lib/whatsapp/customer-window';
import {
  buildPropertyAlertParams,
  PROPERTY_ALERT_TEMPLATE_NAME,
} from '@/lib/whatsapp/property-alert-template';
import type { MessageTemplate, Property } from '@/types';

// POST /api/whatsapp/share-property
// Body: { contact_id: string, property_id: string, message: string }
//
// One property share to one contact through the account's WhatsApp
// Business number, template-first like /api/radar/send: an open 24-hour
// service window sends the caller-composed free-form message; a closed
// window sends the pre-approved property-details template instead
// of dead-ending. Only when the window is closed AND the template isn't
// approved does the share come back unsent, with the template's status
// so the client can say "pending approval" vs "never set up".

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Same local helper as the radar/broadcast routes — renders the
// template body with params for the persisted message text.
function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

/** The contact's conversation (newest first) and whether the 24-hour
 *  window is open — one shape so both send paths share the lookup. */
async function sessionState(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  contactId: string,
): Promise<{ conversationId: string | null; open: boolean }> {
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return { conversationId: null, open: false };

  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id)
    .eq('sender_type', 'customer')
    .gte('created_at', since);
  return { conversationId: conv.id, open: (count ?? 0) > 0 };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(`share-property:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      contact_id?: string;
      property_id?: string;
      message?: string;
    } | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : '';
    const propertyId = typeof body?.property_id === 'string' ? body.property_id : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!contactId || !propertyId || !message) {
      return NextResponse.json(
        { error: 'contact_id, property_id and message are required' },
        { status: 400 },
      );
    }

    // RLS-scoped loads prove both rows belong to the caller's account
    // before any service-role work happens.
    const [{ data: contact, error: contactErr }, { data: property, error: propertyErr }] =
      await Promise.all([
        ctx.supabase
          .from('contacts')
          .select('id, name')
          .eq('id', contactId)
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        ctx.supabase
          .from('properties')
          .select('*')
          .eq('id', propertyId)
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
      ]);
    if (contactErr) throw contactErr;
    if (propertyErr) throw propertyErr;
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    const typedProperty = property as Property;

    const db = adminClient();
    const { conversationId: existingConvId, open } = await sessionState(
      db,
      ctx.accountId,
      contactId,
    );

    const conversationIdAfterSend = async (): Promise<string | null> => {
      if (existingConvId) return existingConvId;
      const { conversationId } = await sessionState(db, ctx.accountId, contactId);
      return conversationId;
    };

    let freeformError: string | undefined;
    if (open) {
      const res = await sendWhatsAppMessageAndPersist({
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId,
        kind: 'text',
        text: message,
        senderType: 'agent',
      });
      if (res.success) {
        return NextResponse.json({
          data: {
            sent: true,
            channel: 'freeform',
            conversation_id: await conversationIdAfterSend(),
          },
        });
      }
      // The window can close between the check and the send — Meta's
      // re-engagement rejection falls through to the template path
      // instead of surfacing as a failure. Anything else is a real error.
      if (!isReengagementError(res.error)) {
        return NextResponse.json({ error: res.error || 'Failed to send' }, { status: 502 });
      }
      freeformError = res.error;
    }

    // Latest alert template row of ANY status, so "not created yet" is
    // distinguishable from "pending Meta approval" (same lookup as radar).
    const { data: latestTemplateRow } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('name', PROPERTY_ALERT_TEMPLATE_NAME)
      .order('last_submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestTemplate = latestTemplateRow as MessageTemplate | null;
    const alertTemplate = latestTemplate?.status === 'APPROVED' ? latestTemplate : null;

    if (!alertTemplate) {
      // Ensure a conversation exists so the client's "Open chat"
      // fallback has a thread to land in (the previous client-side flow
      // created it up front; the inbox hides message-less rows).
      let conversationId = existingConvId;
      if (!conversationId) {
        const { data: newConv } = await db
          .from('conversations')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            contact_id: contactId,
          })
          .select('id')
          .single();
        conversationId = newConv?.id ?? null;
      }
      return NextResponse.json({
        data: {
          sent: false,
          template_status: latestTemplate?.status ?? 'NONE',
          conversation_id: conversationId,
          ...(freeformError ? { freeform_error: freeformError } : {}),
        },
      });
    }

    const params = buildPropertyAlertParams(contact.name as string | null, typedProperty);
    const bodyParams = truncateParametersToBudget(alertTemplate.body_text, [...params]);
    const buttonParams: Record<number, string> = {};
    (alertTemplate.buttons ?? []).forEach((btn, idx) => {
      if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
        // v= attributes portal opens to this contact in Showcase Pulse.
        buttonParams[idx] = `?property_id=${typedProperty.id}&v=${contactId}`;
      }
    });
    const res = await sendWhatsAppMessageAndPersist({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      kind: 'template',
      senderType: 'agent',
      templateName: alertTemplate.name,
      templateLanguage: alertTemplate.language || 'en_US',
      templateParams: bodyParams,
      messageParams: {
        body: bodyParams,
        ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {}),
      },
      templateRow: alertTemplate,
      text: resolveTemplateBodyText(alertTemplate.body_text, bodyParams),
    });
    if (!res.success) {
      return NextResponse.json({ error: res.error || 'Failed to send' }, { status: 502 });
    }
    return NextResponse.json({
      data: {
        sent: true,
        channel: 'template',
        conversation_id: await conversationIdAfterSend(),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
