import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailSyncConfig } from '@/types';
import { sendAutoReply, type SendAutoReplyResult } from './auto-reply';
import {
  sendUnavailableListingReply,
  type UnavailableListingOutcome,
} from './unavailable-listing';

export interface LeadArrivalReplies {
  notice: UnavailableListingOutcome;
  autoReply: SendAutoReplyResult | null;
}

/**
 * What a portal lead hears when their enquiry lands.
 *
 * One message. A lead whose listing has left the market used to get the
 * welcome ("tell me your requirement, I'll share properties") and, two
 * seconds later, the status notice ("the listing is no longer
 * available") — two templates that contradict each other before the
 * lead has said a word. The notice already asks for the requirement, so
 * when it goes out it is the whole greeting; the welcome is sent only
 * when there is no notice to send (the listing is live, or no notice
 * template is approved and the free-form reply was refused).
 */
export async function sendLeadArrivalReplies(args: {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
  syncConfig: EmailSyncConfig | null;
  contactId: string;
  conversationId: string | null;
  cleanPhone: string;
  leadName: string;
  leadSource: string;
  matchedPropertyId: string | null;
}): Promise<LeadArrivalReplies> {
  const notice: UnavailableListingOutcome = args.matchedPropertyId
    ? await sendUnavailableListingReply({
        supabase: args.supabase,
        accountId: args.accountId,
        userId: args.userId,
        contactId: args.contactId,
        conversationId: args.conversationId,
        leadName: args.leadName,
        propertyId: args.matchedPropertyId,
      })
    : 'available';

  if (notice === 'text' || notice === 'template') {
    console.log(
      `[lead-webhook] Listing status notice (${notice}) greeted contact ${args.contactId}; welcome skipped`
    );
    return { notice, autoReply: null };
  }

  const autoReply = await sendAutoReply({
    supabase: args.supabase,
    accountId: args.accountId,
    syncConfig: args.syncConfig,
    conversationId: args.conversationId,
    cleanPhone: args.cleanPhone,
    leadName: args.leadName,
    leadSource: args.leadSource,
    forceSend: true,
  });
  if (!autoReply.success) {
    console.error(
      `[lead-webhook] Auto-reply FAILED for contact ${args.contactId}: ${autoReply.error}`
    );
  } else {
    console.log(
      `[lead-webhook] Auto-reply SENT for contact ${args.contactId}: messageId=${autoReply.messageId}`
    );
  }
  return { notice, autoReply };
}
