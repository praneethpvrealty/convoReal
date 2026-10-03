import {
  applyPreferenceFlowResponse,
  sendPreferenceFlowToContact,
  getPublishedPreferenceFlow,
} from '@/lib/whatsapp/meta-flow-service';
import { sendPreferenceMatchFollowUp } from '@/lib/whatsapp/preference-match-followup';
import { sendPreferenceTapReply } from '@/lib/whatsapp/preference-tap-reply';
import {
  parsePreferenceFormValues,
  preferenceFormToContactUpdate,
  summarizePreferenceUpdate,
} from '@/lib/whatsapp/preference-flow';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Parse update intent from message text
/**
 * Answer a buyer's preference-update request: the listings-first tap
 * reply, then the Buyer Preference Intake flow as an optional shortcut.
 * Returns true when either message was sent (message consumed); false
 * when the account has no published flow or both sends failed, letting
 * the message fall through to normal handling.
 */
export async function handlePreferenceFlowTrigger(
  accountId: string,
  contactId: string,
  configOwnerUserId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const flow = await getPublishedPreferenceFlow(accountId);
    if (!flow) return false;

    const tap = await sendPreferenceTapReply({
      db: supabaseAdmin(),
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
    });

    // When a follow-on list (feedback or budget bands) already carries
    // an "Update preferences" row, a third bubble repeating the form
    // would bury it. Otherwise the form is the main action.
    if (tap.replySent && tap.formOffered) {
      console.log(
        `[webhook] Sent preference tap reply (${tap.matchCount} matches) + tap list to contact ${contactId}`
      );
      return true;
    }

    const result = await sendPreferenceFlowToContact({
      accountId,
      contactId,
      senderType: 'bot',
      // The listings reply already made the ask; the form must not
      // repeat it as homework.
      bodyText: tap.replySent
        ? 'Prefer to update everything at once instead? The full form takes under a minute.'
        : undefined,
    });
    if (!result.success) {
      console.error(`[webhook] Preference flow send failed: ${result.error}`);
      return tap.replySent;
    }
    console.log(
      `[webhook] Sent preference tap reply (${tap.matchCount} matches) + flow to contact ${contactId}`
    );
    return true;
  } catch (err) {
    console.error('[webhook] Preference flow trigger error:', err);
    return false;
  }
}

/**
 * Handle the nfm_reply webhook for a completed preference form.
 * Persists the values (no-op if the encrypted endpoint already did at
 * submit time) and sends the in-chat confirmation summary.
 */
export async function handlePreferenceFlowNfmReply(
  responseJson: string,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  conversationId: string
) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    console.error('[webhook] nfm_reply response_json is not valid JSON');
    return;
  }

  const flowToken =
    typeof parsed.flow_token === 'string' ? parsed.flow_token : null;
  if (!flowToken) {
    console.warn('[webhook] nfm_reply without flow_token — ignoring');
    return;
  }

  const result = await applyPreferenceFlowResponse({
    flowToken,
    values: parsed,
    expectedAccountId: accountId,
  });

  if (!result.applied && !result.alreadyCompleted) {
    console.error(`[webhook] Preference flow reply rejected: ${result.error}`);
    return;
  }
  if (result.session && result.session.contact_id !== contactId) {
    console.error(
      '[webhook] Preference flow token belongs to a different contact — ignoring'
    );
    return;
  }

  // The endpoint's data_exchange response usually saved the values
  // already (alreadyCompleted); recompute the summary from the reply
  // payload so the confirmation always reflects what was submitted.
  const update =
    result.update ??
    preferenceFormToContactUpdate(parsePreferenceFormValues(parsed));

  await sendPreferenceMatchFollowUp({
    db: supabaseAdmin(),
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId,
    acknowledgement: summarizePreferenceUpdate(update),
    reviewNoMatch: false,
  });
}
