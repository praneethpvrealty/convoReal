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
import { logListingsSent } from '@/lib/whatsapp/share-property-send';
import {
  MAX_MATCHES_SENT,
  buildListingLines,
  buildFollowUpQuestion,
  nextQualifierForContact,
} from '@/lib/ai/buyer-qualification';
import { extractEnquiredPropertyFromNote } from '@/lib/contacts/enquiry-note';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sendListingFeedbackPrompt } from '@/lib/whatsapp/listing-feedback';
import { sendBudgetBandPrompt } from '@/lib/whatsapp/budget-band';
import {
  applyDefaultBuyingIntent,
  sendListingIntentPrompt,
} from '@/lib/whatsapp/listing-intent-prompt';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { areaNearMissLine } from '@/lib/buyer/area-near-misses';
import { accountShowcaseBrowseUrl } from '@/lib/showcase/account-showcase-url';
import { showcaseBrowseLine } from '@/lib/inventory/listing-status';
import type { Contact } from '@/types';

/** A lead younger than this is answering their own enquiry, not coming
 *  back from a re-engagement batch; "back on our radar" would tell them
 *  they had been forgotten in the hour since they wrote. */
const RE_ENGAGED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function isReEngagedLead(
  createdAt: string | null | undefined,
  now = Date.now()
): boolean {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(created) && now - created >= RE_ENGAGED_AFTER_MS;
}

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
  /** True for a lead coming back after a quiet spell; false for one
   *  answering the enquiry they made an hour ago. */
  reEngaged?: boolean;
  /** The listings-at-another-price line for their own locality, when
   *  nothing fits (INB-015). */
  nearMiss?: string | null;
  /** The lead's attributed showcase link — every reply hands them the
   *  whole catalogue, whatever the bot found. */
  showcaseUrl?: string | null;
}): string {
  const { contactName, enquiry, listings, question } = args;
  const name = firstName(contactName);
  const opener = args.reEngaged
    ? `Great to hear from you, ${name} 👍 You're back on our radar.`
    : `Thanks for getting back to us, ${name} 👍`;
  const anchor = enquiry ? `your interest in *${enquiry}*` : 'your requirement';
  const browse = args.showcaseUrl
    ? [showcaseBrowseLine(args.showcaseUrl), '']
    : [];

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
      "I'll keep matching new listings against your requirement and send you the right ones as they come in.",
      '',
      ...browse,
      question ??
        "Want photos or a site visit for any of these? Reply with the number and I'll set it up.",
    ].join('\n');
  }

  return [
    opener,
    '',
    `Nothing live right now fits ${anchor} exactly, but I'll keep watching and message you the moment the right property comes in.`,
    '',
    ...(args.nearMiss ? [args.nearMiss, ''] : []),
    ...browse,
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
    const { data: contact } = await db
      .from('contacts')
      .select('*, contact_notes(note_text)')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact)
      return { matchCount: 0, replySent: false, formOffered: false };

    const hadMissingIntent =
      nextQualifierForContact(contact as Contact) === 'intent';
    const defaultedBuying = hadMissingIntent
      ? await applyDefaultBuyingIntent({ db, accountId, contactId })
      : false;

    // strictArea for the same reason as the form follow-up: this goes
    // straight to a buyer who named their area, so the loose 20km
    // radius would surface listings they did not ask about. Only when
    // the tight radius holds nothing does the ordinary one get a turn:
    // "nothing fits" is said after the search the agent would have run,
    // not before it.
    const strictMatches = await rankPropertiesForContact(
      db,
      accountId,
      contactId,
      { strictArea: true, excludeAlreadySent: true }
    );
    const matches =
      strictMatches.length > 0
        ? strictMatches
        : await rankPropertiesForContact(db, accountId, contactId, {
            strictArea: false,
            excludeAlreadySent: true,
          });

    const notes = ((contact as Contact).contact_notes ?? [])
      .map((n) => extractEnquiredPropertyFromNote(n.note_text))
      .filter(Boolean) as string[];

    const missing = nextQualifierForContact(contact as Contact, {
      defaultBuying: defaultedBuying,
    });
    const row = contact as Contact;
    const [baseUrl, showcaseUrl, nearMiss] = await Promise.all([
      accountShowcaseOrigin(db, accountId),
      accountShowcaseBrowseUrl(db, accountId, contactId),
      matches.length === 0
        ? areaNearMissLine({
            db,
            accountId,
            contactId,
            brief: {
              areas: [
                ...(row.areas_of_interest ?? []),
                ...(row.pref_areas ?? []),
              ],
              listingTypes: row.pref_listing_types ?? [],
              budgetMin: row.pref_budget_min ?? row.min_budget ?? null,
              budgetMax: row.pref_budget_max ?? row.max_budget ?? null,
            },
          })
        : Promise.resolve(null),
    ]);
    const contactName = row.name ?? null;

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
      reEngaged: isReEngagedLead(row.created_at),
      nearMiss,
      showcaseUrl,
      question: tapRung
        ? tapRung === 'budget'
          ? defaultedBuying
            ? "I'll assume you're buying. Pick your budget below, or choose Renting instead if needed 👇"
            : "Let's fine-tune it — pick your budget range below 👇"
          : "Let's fine-tune it — buying or renting? Pick below 👇"
        : defaultedBuying && missing
          ? `I'll assume you're buying; reply “renting” if needed. ${buildFollowUpQuestion(missing)}`
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
      await logListingsSent(
        db,
        accountId,
        userId,
        contactId,
        matches.slice(0, MAX_MATCHES_SENT).map((m) => m.property.id)
      );

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
      formOffered =
        tapRung === 'budget'
          ? await sendBudgetBandPrompt({
              db,
              accountId,
              userId,
              contactId,
              conversationId,
              includeFormRow: true,
              includeRentSwitch: defaultedBuying,
            })
          : await sendListingIntentPrompt({
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
