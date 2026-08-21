import { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

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

  // Find pending shares for buyers (not agents)
  const { data: shares, error } = await db
    .from('property_shares')
    .select(`
      id,
      account_id,
      contact_id,
      created_at,
      contacts!inner(id, name)
    `)
    .eq('feedback_status', 'pending')
    .eq('recipient_kind', 'buyer')
    .lte('created_at', thirtyMinsAgo)
    .gte('created_at', twoHoursAgo)
    .limit(50);

  if (error) {
    console.error('[share-feedback] Failed to fetch pending shares:', error);
    return 0;
  }

  if (!shares || shares.length === 0) return 0;

  let sentCount = 0;

  for (const share of shares) {
    // Check if the contact has sent any message since the share was created
    const { data: replies, error: replyError } = await db
      .from('messages')
      .select('id')
      .eq('account_id', share.account_id)
      .eq('contact_id', share.contact_id)
      .eq('direction', 'inbound')
      .gte('created_at', share.created_at)
      .limit(1);

    if (replyError) {
      console.error(`[share-feedback] Failed to check replies for share ${share.id}:`, replyError);
      continue;
    }

    if (replies && replies.length > 0) {
      // Client responded, skip feedback
      await db
        .from('property_shares')
        .update({ feedback_status: 'skipped' })
        .eq('id', share.id);
      continue;
    }

    // Get the account's WhatsApp config to find the owner user ID for dispatch
    const { data: config } = await db
      .from('whatsapp_config')
      .select('user_id')
      .eq('account_id', share.account_id)
      .maybeSingle();

    if (!config) {
      // Can't send without a user_id, skip for now
      continue;
    }

    const { data: contact } = await db
      .from('contacts')
      .select('name, preferred_language')
      .eq('id', share.contact_id)
      .maybeSingle();
      
    if (!contact) continue;

    const { buildShareFeedbackParams, pickShareFeedbackTemplate, SHARE_FEEDBACK_TEMPLATE_NAMES } = await import('./share-feedback-template');
    
    // Find approved template
    const { data: templates } = await db
      .from('message_templates')
      .select('name, language, category')
      .eq('account_id', share.account_id)
      .in('name', SHARE_FEEDBACK_TEMPLATE_NAMES)
      .eq('status', 'APPROVED');
      
    const templateRow = pickShareFeedbackTemplate(templates || []);
    const templateName = templateRow?.name || SHARE_FEEDBACK_TEMPLATE_NAMES[0];
    const templateLanguage = templateRow?.language || contact.preferred_language || 'en_US';

    const params = buildShareFeedbackParams(contact.name);

    try {
      await sendWhatsAppMessageAndPersist({
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

      await db
        .from('property_shares')
        .update({
          feedback_status: 'sent',
          feedback_sent_at: new Date().toISOString(),
        })
        .eq('id', share.id);

      sentCount++;
    } catch (err) {
      console.error(`[share-feedback] Failed to send feedback template for share ${share.id}:`, err);
    }
  }

  return sentCount;
}
