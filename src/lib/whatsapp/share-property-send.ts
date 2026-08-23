import {
  createClient as createServiceClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { findConversation, resolveConversationId } from '@/lib/conversations/resolve';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import { isReengagementError } from '@/lib/whatsapp/customer-window';
import { resolveSendLanguage, isLanguageFallback } from '@/lib/whatsapp/template-language';
import {
  PROPERTY_SHARE_TEMPLATE_NAMES,
  pickPropertyShareTemplate,
  propertyShareParams,
  shareHeaderImage,
} from '@/lib/whatsapp/property-share-template';
import {
  accountBrandImage,
  accountBrandName,
} from '@/lib/showcase/account-showcase-url';
import type { MessageTemplate, Property } from '@/types';

// One property share to one contact through the account's WhatsApp
// Business number, template-first: an open 24-hour service window sends
// the caller-composed free-form message; a closed window sends the
// pre-approved property-details template instead of dead-ending. Only
// when the window is closed AND the template isn't approved does the
// share come back unsent, carrying the template's status so callers can
// say "pending approval" vs "never set up".
//
// Extracted from /api/whatsapp/share-property so the approve route can
// run the same send without a second HTTP hop from the client — these
// rules are subtle enough that a second copy would drift.

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Property share ledger row for a confirmed send — the same table the
 *  web share dialog writes through src/lib/inventory/share-log.ts, so
 *  the Matching Contacts list marks a recipient as already contacted
 *  whichever surface sent it. Best-effort: a ledger failure must never
 *  turn a delivered message into a reported error. */
export async function logPropertyShare(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  propertyId: string,
  contactId: string,
) {
  const { data: contact } = await db
    .from('contacts')
    .select('classification')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  const { error } = await db.from('property_shares').upsert(
    {
      account_id: accountId,
      property_id: propertyId,
      contact_id: contactId,
      recipient_kind: contact?.classification === 'Agent' ? 'agent' : 'buyer',
      channel: 'whatsapp',
      created_by: userId,
    },
    { onConflict: 'account_id,property_id,contact_id', ignoreDuplicates: true },
  );
  if (error) console.error('[share-property-send] share ledger failed:', error.message);
}

/**
 * The same ledger row for a batch the BOT sent — an alert shortlist, a
 * follow-up, a preference reply.
 *
 * Until this existed the ledger only knew about shares a person made
 * from the web app, so an automated shortlist could re-offer a listing
 * an agent had sent by hand weeks earlier: one went out to a buyer on
 * 11 July and came back as "here's one that fits" on 23 August, because
 * the only guard compared titles against the last few bot messages in
 * the thread. What was sent has to outlive the window it was sent in.
 *
 * Best-effort, like its single-row twin: a ledger failure must never
 * turn a delivered message into a reported error.
 */
export async function logListingsSent(
  db: SupabaseClient,
  accountId: string,
  userId: string | null,
  contactId: string,
  propertyIds: string[],
): Promise<void> {
  if (propertyIds.length === 0) return;
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('classification')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    const { error } = await db.from('property_shares').upsert(
      [...new Set(propertyIds)].map((propertyId) => ({
        account_id: accountId,
        property_id: propertyId,
        contact_id: contactId,
        recipient_kind: contact?.classification === 'Agent' ? 'agent' : 'buyer',
        channel: 'whatsapp',
        created_by: userId,
      })),
      { onConflict: 'account_id,property_id,contact_id', ignoreDuplicates: true },
    );
    if (error) console.error('[share-property-send] bot share ledger failed:', error.message);
  } catch (err) {
    console.error('[share-property-send] bot share ledger threw:', err);
  }
}

/** Renders a template body with its params, for the persisted text. */
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
  const conv = await findConversation<{ id: string }>(db, {
    accountId,
    contactId,
    columns: 'id',
  });
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

export interface SharePropertyOutcome {
  sent: boolean;
  channel?: 'freeform' | 'template';
  conversationId: string | null;
  /** Set when nothing went out: the alert template's status, or 'NONE'. */
  templateStatus?: string;
  /** A free-form attempt that Meta rejected for being out of window. */
  freeformError?: string;
  /** A real send failure — the caller should surface this, not retry. */
  error?: string;
}

export async function sendPropertyToContact(opts: {
  accountId: string;
  userId: string;
  contactId: string;
  contactName: string | null;
  property: Property;
  message: string;
}): Promise<SharePropertyOutcome> {
  const { accountId, userId, contactId, contactName, property, message } = opts;
  const db = adminClient();
  const { conversationId: existingConvId, open } = await sessionState(db, accountId, contactId);

  const conversationIdAfterSend = async (): Promise<string | null> => {
    if (existingConvId) return existingConvId;
    const { conversationId } = await sessionState(db, accountId, contactId);
    return conversationId;
  };

  // One lookup, whichever branch ends up sending: the open-window path
  // puts it inline, the template path puts it in the header, and a
  // free-form attempt that hits a closed window falls through to the
  // second having already resolved it.
  const brandImageOnce = accountBrandImage(db, accountId);

  let freeformError: string | undefined;
  if (open) {
    // Lead with the photo here too. The template path below has always
    // put the listing's image in its header; the open-window path sent
    // the same listing as a wall of text, so which channel carried a
    // share decided whether the buyer saw the property. Same choice as
    // the Radar alert: image first, then the composed message.
    //
    // Best-effort — a photo that will not send must never cost the
    // share. The text goes out either way.
    const inlineImage = shareHeaderImage({
      images: property.images,
      brandImage: await brandImageOnce,
    });
    if (inlineImage) {
      const img = await sendWhatsAppMessageAndPersist({
        accountId,
        userId,
        contactId,
        kind: 'media',
        mediaKind: 'image',
        mediaLink: inlineImage,
        mediaCaption: property.title,
        senderType: 'agent',
      });
      if (!img.success) {
        console.error('[share-property-send] photo send failed:', img.error);
      }
    }
    const res = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId,
      kind: 'text',
      text: message,
      senderType: 'agent',
    });
    if (res.success) {
      await logPropertyShare(db, accountId, userId, property.id, contactId);
      return {
        sent: true,
        channel: 'freeform',
        conversationId: await conversationIdAfterSend(),
      };
    }
    // The window can close between the check and the send — Meta's
    // re-engagement rejection falls through to the template path
    // instead of surfacing as a failure. Anything else is a real error.
    if (!isReengagementError(res.error)) {
      return { sent: false, conversationId: existingConvId, error: res.error || 'Failed to send' };
    }
    freeformError = res.error;
  }

  // Every candidate name, not just the current one: a rename ships the
  // branded template under a name Meta has not ruled on, and the
  // previously approved row has to keep sending until it clears. The
  // latest row of ANY status is kept so "not created yet" stays
  // distinguishable from "pending Meta approval" (same lookup as radar).
  const { data: templateRows } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .in('name', PROPERTY_SHARE_TEMPLATE_NAMES)
    .order('last_submitted_at', { ascending: false, nullsFirst: false });
  const candidates = (templateRows || []) as MessageTemplate[];
  const latestTemplate = candidates[0] ?? null;

  // Lead with the listing's own photo, or the account's brand card when
  // it has none — a property message that leads with the property is a
  // different message from one that does not, and the header is a
  // send-time parameter so it costs nothing at the category level.
  const [brandImage, brandName, language] = await Promise.all([
    brandImageOnce,
    accountBrandName(db, accountId),
    resolveSendLanguage(db, accountId, contactId),
  ]);
  const headerImage = shareHeaderImage({ images: property.images, brandImage });
  const alertTemplate = pickPropertyShareTemplate(candidates, {
    hasImage: Boolean(headerImage),
    language,
  });
  if (isLanguageFallback(alertTemplate, language)) {
    // Not an error — the send still goes out. But an account that set a
    // language and never approved a variant for it has a gap only this
    // line will ever show them.
    console.warn(
      `[share-property-send] no approved ${language} variant for account ${accountId}; sent ${alertTemplate?.language ?? 'none'}`,
    );
  }

  if (!alertTemplate) {
    // Ensure a conversation exists so the client's "Open chat" fallback
    // has a thread to land in (the inbox hides message-less rows).
    let conversationId = existingConvId;
    if (!conversationId) {
      conversationId = await resolveConversationId(db, {
        accountId,
        contactId,
        userId,
      });
    }
    return {
      sent: false,
      conversationId,
      templateStatus: latestTemplate?.status ?? 'NONE',
      ...(freeformError ? { freeformError } : {}),
    };
  }

  // Param count follows the template's NAME: the signed revisions
  // carry the brokerage as {{2}}, their approved predecessors do not,
  // and Meta rejects a send that hands either the wrong number.
  const params = propertyShareParams(
    alertTemplate.name,
    contactName,
    property,
    brandName,
  );
  const bodyParams = truncateParametersToBudget(alertTemplate.body_text, [...params]);
  const buttonParams: Record<number, string> = {};
  (alertTemplate.buttons ?? []).forEach((btn, idx) => {
    if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
      // v= attributes portal opens to this contact in Showcase Pulse.
      buttonParams[idx] = `?property_id=${property.id}&v=${contactId}`;
    }
  });
  const res = await sendWhatsAppMessageAndPersist({
    accountId,
    userId,
    contactId,
    kind: 'template',
    senderType: 'agent',
    templateName: alertTemplate.name,
    templateLanguage: alertTemplate.language || 'en_US',
    templateParams: bodyParams,
    messageParams: {
      body: bodyParams,
      ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {}),
      // Only meaningful to a template with a media header; the text one
      // ignores it, so both branches send the same call.
      ...(headerImage ? { headerMediaUrl: headerImage } : {}),
    },
    templateRow: alertTemplate,
    text: resolveTemplateBodyText(alertTemplate.body_text, bodyParams),
  });
  if (!res.success) {
    return { sent: false, conversationId: existingConvId, error: res.error || 'Failed to send' };
  }
  await logPropertyShare(db, accountId, userId, property.id, contactId);
  return { sent: true, channel: 'template', conversationId: await conversationIdAfterSend() };
}
