import { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { lookupConversation } from '@/lib/conversations/resolve';
import { withContactConversationLease } from '@/lib/conversations/outbound-lease';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { templateButtonLabel } from '@/lib/whatsapp/template-copy';
import { resolveSendLanguage } from '@/lib/whatsapp/template-language';
import type { InteractiveButton } from '@/lib/whatsapp/meta-api';

export function shareFeedbackButtons(propertyId: string): InteractiveButton[] {
  return [
    {
      id: `lfb_y_${propertyId}`,
      title: templateButtonLabel('feedback_perfect', 'en'),
    },
    {
      id: `lfb_n_${propertyId}`,
      title: templateButtonLabel('feedback_not_interested', 'en'),
    },
    { id: 'lfb_form', title: 'Update preferences' },
  ];
}

export async function findFeedbackSharePropertyId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  contextMessageId: string | null
): Promise<string | null> {
  if (!contextMessageId) return null;
  const sharesOnPrompt = () =>
    db
      .from('property_shares')
      .select('property_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('feedback_message_id', contextMessageId);
  const { data: first, error: firstError } = await sharesOnPrompt()
    .limit(1)
    .maybeSingle();
  const propertyId = (first?.property_id as string | null | undefined) ?? null;
  if (firstError || !propertyId) return null;
  const { data: other, error: otherError } = await sharesOnPrompt()
    .or(`property_id.is.null,property_id.neq.${propertyId}`)
    .limit(1)
    .maybeSingle();
  return otherError || other ? null : propertyId;
}

export const SHARE_FEEDBACK_CLAIM_STALE_MS = 15 * 60 * 1000;
export const SHARE_FEEDBACK_CLAIM_GRACE_MS = 30 * 60 * 1000;

/**
 * Finds property shares to buyers that are older than 30 minutes and have
 * not yet received a feedback request or had a reply from the buyer.
 */
export async function processShareFeedbackFollowups(
  db: SupabaseClient
): Promise<number> {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  // Don't go back forever, just the last 2 hours to avoid spamming old shares
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const claimGraceStart = new Date(
    Date.now() - 2 * 60 * 60 * 1000 - SHARE_FEEDBACK_CLAIM_GRACE_MS
  ).toISOString();

  // Find pending shares for buyers (not agents)
  const { data: shares, error } = await db
    .from('property_shares')
    .select(
      `
      id,
      account_id,
      contact_id,
      property_id,
      created_at,
      contacts!inner(id, name)
    `
    )
    .eq('feedback_status', 'pending')
    .eq('recipient_kind', 'buyer')
    .lte('created_at', thirtyMinsAgo)
    .or(
      `created_at.gte.${twoHoursAgo},and(feedback_sent_at.not.is.null,created_at.gte.${claimGraceStart})`
    )
    .limit(50);

  if (error) {
    console.error('[share-feedback] Failed to fetch pending shares:', error);
    return 0;
  }

  if (!shares || shares.length === 0) return 0;

  let sentCount = 0;

  for (const share of shares) {
    const claimedAt = new Date().toISOString();
    const staleBefore = new Date(
      Date.now() - SHARE_FEEDBACK_CLAIM_STALE_MS
    ).toISOString();
    const { data: claimed, error: claimError } = await db
      .from('property_shares')
      .update({ feedback_sent_at: claimedAt })
      .eq('id', share.id)
      .eq('account_id', share.account_id)
      .eq('feedback_status', 'pending')
      .or(`feedback_sent_at.is.null,feedback_sent_at.lt.${staleBefore}`)
      .select('id')
      .maybeSingle();
    if (claimError) {
      console.error(
        `[share-feedback] Failed to claim share ${share.id}:`,
        claimError
      );
      continue;
    }
    if (!claimed) continue;

    const release = () =>
      db
        .from('property_shares')
        .update({ feedback_sent_at: null })
        .eq('id', share.id)
        .eq('account_id', share.account_id)
        .eq('feedback_status', 'pending')
        .eq('feedback_sent_at', claimedAt);

    const outcome = await withContactConversationLease(
      db,
      share.account_id,
      share.contact_id,
      () => sendShareFeedback(db, share)
    );
    if (outcome.status === 'ran' && outcome.value === 'sent') {
      sentCount++;
    } else if (outcome.status !== 'ran' || outcome.value === 'retry') {
      await release();
    }
  }

  return sentCount;
}

async function sendShareFeedback(
  db: SupabaseClient,
  share: {
    id: string;
    account_id: string;
    contact_id: string;
    property_id: string | null;
    created_at: string;
  }
): Promise<'sent' | 'skipped' | 'retry'> {
  const { conversation, error: replyError } = await lookupConversation<{
    last_customer_message_at: string | null;
  }>(db, {
    accountId: share.account_id,
    contactId: share.contact_id,
    columns: 'last_customer_message_at',
  });

  if (replyError) {
    console.error(
      `[share-feedback] Failed to check replies for share ${share.id}:`,
      replyError
    );
    return 'retry';
  }

  const hasReplied =
    !!conversation?.last_customer_message_at &&
    conversation.last_customer_message_at >= share.created_at;

  if (hasReplied) {
    await db
      .from('property_shares')
      .update({ feedback_status: 'skipped', feedback_sent_at: null })
      .eq('id', share.id)
      .eq('account_id', share.account_id);
    return 'skipped';
  }

  const { data: config } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', share.account_id)
    .maybeSingle();
  if (!config) return 'retry';

  const { data: contact } = await db
    .from('contacts')
    .select('name, preferred_language')
    .eq('id', share.contact_id)
    .maybeSingle();
  if (!contact) return 'retry';

  const {
    buildShareFeedbackParams,
    buildShareFeedbackButtonsBody,
    pickShareFeedbackTemplate,
    renderShareFeedbackBody,
    SHARE_FEEDBACK_TEMPLATE_NAMES,
  } = await import('./share-feedback-template');

  const { data: templates } = await db
    .from('message_templates')
    .select('name, language, category')
    .eq('account_id', share.account_id)
    .in('name', SHARE_FEEDBACK_TEMPLATE_NAMES)
    .eq('status', 'APPROVED');

  const templateRow = pickShareFeedbackTemplate(templates || []);
  const templateName = templateRow?.name || SHARE_FEEDBACK_TEMPLATE_NAMES[0];
  const templateLanguage =
    templateRow?.language || contact.preferred_language || 'en_US';

  const params = buildShareFeedbackParams(contact.name);

  let property: { id: string; title: string | null } | null = null;
  if (
    share.property_id &&
    isWithinCustomerWindow(conversation?.last_customer_message_at) &&
    (await resolveSendLanguage(db, share.account_id, share.contact_id)) === 'en'
  ) {
    const { data, error: propertyError } = await db
      .from('properties')
      .select('id, title')
      .eq('id', share.property_id)
      .eq('account_id', share.account_id)
      .maybeSingle();
    if (propertyError) {
      console.error(
        `[share-feedback] Failed to load the property for share ${share.id}:`,
        propertyError
      );
      return 'retry';
    }
    property = data;
  }

  let feedbackMessageId: string | null = null;
  try {
    const result = property?.title
      ? await sendWhatsAppMessageAndPersist({
          accountId: share.account_id,
          userId: config.user_id,
          contactId: share.contact_id,
          kind: 'interactive',
          senderType: 'bot',
          interactiveType: 'buttons',
          interactiveBody: buildShareFeedbackButtonsBody(
            params[0],
            property.title
          ),
          interactiveButtons: shareFeedbackButtons(property.id),
          customDbClient: db,
        })
      : await sendWhatsAppMessageAndPersist({
          accountId: share.account_id,
          userId: config.user_id,
          contactId: share.contact_id,
          kind: 'template',
          senderType: 'bot',
          templateName,
          templateLanguage,
          templateParams: params,
          text: renderShareFeedbackBody(params, templateLanguage),
          customDbClient: db,
        });
    if (result?.success === false) {
      console.error(
        `[share-feedback] Feedback template for share ${share.id} was not sent:`,
        result.error
      );
      return 'retry';
    }
    feedbackMessageId = result?.whatsappMessageId ?? null;
  } catch (err) {
    console.error(
      `[share-feedback] Failed to send feedback template for share ${share.id}:`,
      err
    );
    return 'retry';
  }

  const sentAt = new Date().toISOString();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error: markError } = await db
      .from('property_shares')
      .update({
        feedback_status: 'sent',
        feedback_sent_at: sentAt,
        feedback_message_id: feedbackMessageId,
      })
      .eq('id', share.id)
      .eq('account_id', share.account_id);
    if (!markError) break;
    console.error(
      `[share-feedback] Failed to mark share ${share.id} sent (attempt ${attempt}):`,
      markError
    );
  }
  return 'sent';
}
