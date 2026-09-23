import { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { lookupConversation } from '@/lib/conversations/resolve';
import { withContactConversationLease } from '@/lib/conversations/outbound-lease';

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
    pickShareFeedbackTemplate,
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

  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: share.account_id,
      userId: config.user_id,
      contactId: share.contact_id,
      kind: 'template',
      senderType: 'bot',
      templateName,
      templateLanguage,
      templateParams: params,
      customDbClient: db,
    });
    if (result?.success === false) {
      console.error(
        `[share-feedback] Feedback template for share ${share.id} was not sent:`,
        result.error
      );
      return 'retry';
    }
  } catch (err) {
    console.error(
      `[share-feedback] Failed to send feedback template for share ${share.id}:`,
      err
    );
    return 'retry';
  }

  await db
    .from('property_shares')
    .update({
      feedback_status: 'sent',
      feedback_sent_at: new Date().toISOString(),
    })
    .eq('id', share.id)
    .eq('account_id', share.account_id);
  return 'sent';
}
