// What happens after a lead submits the Buyer Preference Intake form.
//
// The confirmation summary ends with "We'll use these to match you with
// the right properties", and until now nothing made that true: the
// values were saved, a receipt was sent, and the thread went quiet. That
// is the highest-intent moment in a re-engagement batch — the lead has
// tapped a button, filled in a form, and their reply has opened a
// 24-hour customer service window.
//
// Inside that window sends are free-form, so template categories do not
// apply and there is no per-recipient marketing cap to drop the message.
// The same ranking and the same reply the WhatsApp lead-qualification
// path already uses is reused here, so a lead who arrives by form and a
// lead who arrives by chat are shown the same inventory the same way.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  rankPropertiesForContact,
  generateMatchEventForContact,
} from '@/lib/radar/engine';
import { buildMatchesReply } from '@/lib/ai/buyer-qualification';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sendListingFeedbackPrompt } from '@/lib/whatsapp/listing-feedback';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';

export interface PreferenceMatchFollowUpResult {
  matchCount: number;
  replySent: boolean;
}

/**
 * Sent when the account holds nothing that fits. Silence would read as
 * the form having gone nowhere, and these leads were re-engaged on the
 * promise of hearing about what suits them.
 */
export function buildNoLiveMatchReply(
  contactName: string | null | undefined
): string {
  const name = isPlaceholderLeadName(contactName)
    ? 'there'
    : contactName!.trim().split(/\s+/)[0];
  return [
    `Thanks ${name} — nothing in our current inventory fits that yet.`,
    '',
    "Your requirement is saved, and you'll hear from us as soon as something matching comes in. If anything changes, just reply here.",
  ].join('\n');
}

/**
 * Ranks live inventory against the preferences the lead just submitted
 * and replies with the best matches.
 *
 * Never throws: a failure here must not cost the caller the preference
 * save or the confirmation that already went out.
 */
export async function sendPreferenceMatchFollowUp(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
}): Promise<PreferenceMatchFollowUpResult> {
  const { db, accountId, userId, contactId, conversationId } = args;

  try {
    const { data: contact } = await db
      .from('contacts')
      .select('name')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();

    // strictArea tightens locality matching from the default 20km to
    // 5km. Radar suggests to an agent who filters before sending; this
    // goes straight to a buyer who just named their area, so the loose
    // radius would surface listings they did not ask about.
    const matches = await rankPropertiesForContact(db, accountId, contactId, {
      strictArea: true,
    });

    const contactName = (contact?.name as string | null) ?? null;
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const text =
      matches.length > 0
        ? buildMatchesReply(contactName, matches, baseUrl, contactId)
        : buildNoLiveMatchReply(contactName);

    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
      customDbClient: db,
    });

    if (matches.length > 0 && result.success) {
      // One tap per listing beats "reply with the number". No form row:
      // this lead just completed the form.
      await sendListingFeedbackPrompt({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
        matches,
      });

      // Surface the same listings on Match Radar so the agent picks the
      // thread up already knowing what the lead was shown.
      void generateMatchEventForContact(db, accountId, contactId).catch(
        (err) => {
          console.error('[preference-followup] radar event failed:', err);
        }
      );
    }

    return { matchCount: matches.length, replySent: result.success };
  } catch (err) {
    console.error('[preference-followup] failed:', err);
    return { matchCount: 0, replySent: false };
  }
}
