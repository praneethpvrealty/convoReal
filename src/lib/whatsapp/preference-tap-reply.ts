// What a lead sees when they tap "Update my preferences".
//
// The tap used to be answered with only the form — homework, when the
// tap itself is the first sign of life from a re-engaged lead. The
// funnel across batches 1–4: 20 tapped or replied, 7 forms sent, 2
// opened, 1 completed. Interest is not the leak; the form is.
//
// So the tap is answered with inventory first: congratulate the
// response, show the live listings that already fit the enquiry the
// lead came in on, promise the engine keeps matching, and ask the one
// qualifier that sharpens matching most — answerable by just replying,
// which processBuyerQualificationMessage already parses as an answer
// to the question directly before it. The form still follows, demoted
// to an optional shortcut rather than the whole turn.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  rankPropertiesForContact,
  generateMatchEventForContact,
} from '@/lib/radar/engine';
import {
  buildListingLines,
  buildFollowUpQuestion,
  nextQualifierForContact,
} from '@/lib/ai/buyer-qualification';
import { extractEnquiredPropertyFromNote } from '@/lib/contacts/enquiry-note';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sendListingFeedbackPrompt } from '@/lib/whatsapp/listing-feedback';
import { sendBudgetBandPrompt } from '@/lib/whatsapp/budget-band';
import { sendListingIntentPrompt } from '@/lib/whatsapp/listing-intent-prompt';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import type { Contact } from '@/types';

export interface PreferenceTapReplyResult {
  matchCount: number;
  replySent: boolean;
  /** True when a follow-on list already offers the full form as a row,
   *  so the caller must not send the form as its own message. */
  formOffered: boolean;
}

function firstName(name: string | null | undefined): string {
  return isPlaceholderLeadName(name) ? 'there' : name!.trim().split(/\s+/)[0];
}

/**
 * Pure text of the tap reply, testable without a database.
 *
 * The form's own message follows this one, so the closing line never
 * mentions tapping anything — the question must read as answerable by
 * replying right here.
 */
export function buildPreferenceTapReply(args: {
  contactName: string | null | undefined;
  /** The enquiry as the portal phrased it, or null when unrecoverable. */
  enquiry: string | null;
  listings: string[];
  question: string | null;
}): string {
  const { contactName, enquiry, listings, question } = args;
  const opener = `Great to hear from you, ${firstName(contactName)} 👍 You're back on our radar.`;
  const anchor = enquiry ? `your interest in *${enquiry}*` : 'your requirement';

  if (listings.length > 0) {
    const count =
      listings.length === 1
        ? "here's one live option"
        : `here are ${listings.length} live options`;
    return [
      opener,
      '',
      `Based on ${anchor}, ${count} from our inventory:`,
      '',
      listings.join('\n\n'),
      '',
      'Our intelligent matching engine will keep sharing the right properties at the right time as new listings come in.',
      '',
      question ??
        "Want photos or a site visit for any of these? Reply with the number and I'll set it up.",
    ].join('\n');
  }

  return [
    opener,
    '',
    `Nothing live right now fits ${anchor} exactly, but our intelligent matching engine keeps watching — you'll hear from us the moment the right property comes in.`,
    '',
    question ??
      'If anything about your requirement has changed, just reply here.',
  ].join('\n');
}

/**
 * Ranks live inventory against the lead's enquiry and sends the tap
 * reply. Never throws: the caller still owes the lead the preference
 * form, and a ranking failure must not cost them that.
 */
export async function sendPreferenceTapReply(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
}): Promise<PreferenceTapReplyResult> {
  const { db, accountId, userId, contactId, conversationId } = args;

  try {
    const [{ data: contact }, matches] = await Promise.all([
      db
        .from('contacts')
        .select('*, contact_notes(note_text)')
        .eq('id', contactId)
        .eq('account_id', accountId)
        .maybeSingle(),
      // strictArea for the same reason as the form follow-up: this goes
      // straight to a buyer who named their area, so the loose 20km
      // radius would surface listings they did not ask about.
      rankPropertiesForContact(db, accountId, contactId, { strictArea: true }),
    ]);
    if (!contact)
      return { matchCount: 0, replySent: false, formOffered: false };

    const notes = ((contact as Contact).contact_notes ?? [])
      .map((n) => extractEnquiredPropertyFromNote(n.note_text))
      .filter(Boolean) as string[];

    const missing = nextQualifierForContact(contact as Contact);
    const baseUrl = await accountShowcaseOrigin(db, accountId);
    const contactName = (contact as Contact).name ?? null;

    // With no matches and a tappable rung missing, the question becomes
    // a tap: the list follows instead of a typed answer, and it carries
    // the form row, so the closing line points down rather than asking.
    const tapRung =
      matches.length === 0 && (missing === 'budget' || missing === 'intent')
        ? missing
        : null;

    const text = buildPreferenceTapReply({
      contactName,
      enquiry: notes[0] ?? null,
      listings: buildListingLines(contactName, matches, baseUrl, contactId),
      question: tapRung
        ? tapRung === 'budget'
          ? "Let's fine-tune it — pick your budget range below 👇"
          : "Let's fine-tune it — buying or renting? Pick below 👇"
        : missing
          ? buildFollowUpQuestion(missing)
          : null,
    });

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

    let formOffered = false;

    if (matches.length > 0 && result.success) {
      // One tap per listing beats "reply with the number": the form row
      // inside the list also replaces the separate form message, so the
      // whole turn stays at two bubbles.
      formOffered = await sendListingFeedbackPrompt({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
        matches,
        includeFormRow: true,
      });

      // Surface the same listings on Match Radar so the agent picks the
      // thread up already knowing what the lead was shown.
      void generateMatchEventForContact(db, accountId, contactId).catch(
        (err) => {
          console.error('[preference-tap] radar event failed:', err);
        }
      );
    } else if (tapRung && result.success) {
      const sendRung =
        tapRung === 'budget' ? sendBudgetBandPrompt : sendListingIntentPrompt;
      formOffered = await sendRung({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
        includeFormRow: true,
      });
    }

    return {
      matchCount: matches.length,
      replySent: result.success,
      formOffered,
    };
  } catch (err) {
    console.error('[preference-tap] failed:', err);
    return { matchCount: 0, replySent: false, formOffered: false };
  }
}
