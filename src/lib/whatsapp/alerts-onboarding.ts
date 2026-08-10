// The onboarding ladder behind START ALERTS.
//
// The wa.me invite pre-fills "START ALERTS"; sending it opens a
// 24-hour free-form window at the lead's moment of highest intent.
// Consent used to be the whole transaction — one confirmation line,
// window closed, profile still empty. Now the same moment runs the
// first missing rung of the qualification ladder, one tap at a time:
// type list, then budget bands, then a typed area question. A lead
// whose profile is already complete skips the questions and gets the
// proof instead — their current matches.
//
// Re-entrant by design: every tapped answer routes back here, and the
// next missing rung (or the shortlist) is the acknowledgement.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  nextQualifierForContact,
  buildFollowUpQuestion,
} from '@/lib/ai/buyer-qualification';
import { sendPropertyTypePrompt } from '@/lib/whatsapp/property-type-prompt';
import { sendBudgetBandPrompt } from '@/lib/whatsapp/budget-band';
import { sendPreferenceMatchFollowUp } from '@/lib/whatsapp/preference-match-followup';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { Contact } from '@/types';

/**
 * Sends the next missing rung of the ladder, or the matches when the
 * profile is complete. Never throws — consent is already recorded and
 * a ladder failure must not undo the confirmation that went out.
 */
export async function sendAlertsOnboarding(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
}): Promise<void> {
  const { db, accountId, userId, contactId, conversationId } = args;

  try {
    const { data: contact } = await db
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact) return;

    const missing = nextQualifierForContact(contact as Contact);

    if (missing === 'type') {
      await sendPropertyTypePrompt({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
        includeFormRow: true,
      });
      return;
    }

    if (missing === 'budget') {
      await sendBudgetBandPrompt({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
        includeFormRow: true,
      });
      return;
    }

    if (missing === 'location') {
      // Localities don't fit in ten list rows; the typed answer is
      // parsed by the qualification ladder like any bare reply.
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId,
        contactId,
        conversationId,
        kind: 'text',
        senderType: 'bot',
        text: buildFollowUpQuestion('location'),
        customDbClient: db,
      });
      return;
    }

    // Profile complete — prove it. Sends the current shortlist (with
    // its feedback list) or the engine promise when nothing fits yet.
    await sendPreferenceMatchFollowUp({
      db,
      accountId,
      userId,
      contactId,
      conversationId,
    });
  } catch (err) {
    console.error('[alerts-onboarding] failed:', err);
  }
}
