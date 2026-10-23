import type { SupabaseClient } from '@supabase/supabase-js';
import { unavailableListingReply } from '@/lib/inventory/listing-status';
import { unavailableListingReplyWithShowcase } from '@/lib/inventory/unavailable-reply';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sendRequirementConfirmAfterRegret } from '@/lib/whatsapp/unavailable-brief-followup';

// The one answer a lead gets, inside their window, for a listing that
// has left the market — whichever bot path they reached it through: a
// "Send more details" tap, the share-yes button, a shortlist pick, a
// photo request, an enquiry-card approval. Said once: the lead who
// already holds this exact reply in the thread hears nothing again.

export type UnavailableListingReplyOutcome = 'sent' | 'already_told' | 'failed';

export async function replyListingUnavailableOnce(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string | null | undefined;
  contactId: string;
  conversationId: string;
  toPhone?: string;
  /** Looked up when not supplied. */
  contactName?: string | null;
  property: { title: string | null; status: string | null | undefined };
}): Promise<UnavailableListingReplyOutcome | null> {
  const { db, accountId, userId, contactId, conversationId, property } = args;
  if (!unavailableListingReply(null, property.title, property.status))
    return null;

  const contactName =
    args.contactName !== undefined
      ? args.contactName
      : (((
          await db
            .from('contacts')
            .select('name')
            .eq('id', contactId)
            .eq('account_id', accountId)
            .maybeSingle()
        ).data?.name as string | null | undefined) ?? null);

  const reply = await unavailableListingReplyWithShowcase({
    db,
    accountId,
    contactId,
    contactName,
    propertyTitle: property.title,
    status: property.status,
  });
  if (!reply) return null;

  const { data: alreadyTold } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('content_text', reply)
    .neq('status', 'failed')
    .limit(1)
    .maybeSingle();
  if (alreadyTold) return 'already_told';

  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId,
    contactId,
    conversationId,
    ...(args.toPhone ? { toPhone: args.toPhone } : {}),
    kind: 'text',
    senderType: 'bot',
    text: reply,
  });
  // A send Meta accepted is a message the lead has, whatever failed
  // after it; anything else left them with nothing, and the caller
  // must not claim otherwise.
  if (result.success || result.reachedMeta) {
    if (userId) {
      await sendRequirementConfirmAfterRegret({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
      });
    }
    return 'sent';
  }
  console.error(
    `[unavailable-listing-reply] regret to contact ${contactId} failed: ${result.error}`
  );
  return 'failed';
}
