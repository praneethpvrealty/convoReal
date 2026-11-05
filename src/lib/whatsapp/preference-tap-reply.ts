// What a lead sees when they tap "Update my preferences".
//
// The tap used to be answered with only the form — homework, when the
// tap itself is the first sign of life from a re-engaged lead. The
// funnel across batches 1–4: 20 tapped or replied, 7 forms sent, 2
// opened, 1 completed. Interest is not the leak; the form is.
//
// So the tap is answered with inventory first: show the live listings
// that already fit the enquiry the lead came in on, promise the engine
// keeps matching, and ask the one qualifier that sharpens matching most
// — answerable by just replying, which processBuyerQualificationMessage
// already parses as an answer to the question directly before it.
//
// The button carries no reference to the listing it sat under, so the
// listing is resolved the way "Close my enquiry" resolves it: the
// quoted template first, then the thread, then the recorded enquiry.
// That listing anchors the reply — the opener names it instead of
// welcoming the lead back a minute after a notice told them their deal
// fell through — and seeds the requirement of a contact who has none,
// so the matcher ranks against the plot, size, locality and price the
// enquiry already stated instead of against an empty record.
//
// When nothing fits, the reply ends on one tappable menu of next moves
// (src/lib/whatsapp/preference-next-steps.ts) rather than a typed
// question and a second bubble repeating the form the lead just
// declined. With listings, the feedback list carries the form row.

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
  namedLocality,
  nextQualifierForContact,
  shortlistOutsideLocality,
} from '@/lib/ai/buyer-qualification';
import { extractEnquiredPropertyFromNote } from '@/lib/contacts/enquiry-note';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sendListingFeedbackPrompt } from '@/lib/whatsapp/listing-feedback';
import { applyDefaultBuyingIntent } from '@/lib/whatsapp/listing-intent-prompt';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { areaNearMissLine } from '@/lib/buyer/area-near-misses';
import { accountShowcaseBrowseUrl } from '@/lib/showcase/account-showcase-url';
import {
  isListingLive,
  showcaseBrowseLine,
} from '@/lib/inventory/listing-status';
import { resolveDroppedProperty } from '@/lib/whatsapp/enquiry-dropoff';
import { describeEnquiredProperty } from '@/lib/whatsapp/enquiry-notice-template';
import { seedRequirementFromListing } from '@/lib/contacts/seed-from-listing';
import {
  listingNoun,
  sendPreferenceNextStepsPrompt,
} from '@/lib/whatsapp/preference-next-steps';
import type { Contact, Property } from '@/types';

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

export const NEXT_STEPS_CLOSING = 'Pick what to try next 👇';

/**
 * Pure text of the tap reply, testable without a database.
 *
 * A list follows this message, so the closing line never mentions
 * tapping anything unless it points at that list — a typed question
 * must read as answerable by replying right here.
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
  outside?: { locality: string; widened: boolean } | null;
  /** The listing the tapped notice named, when it is no longer live:
   *  the opener names it and never welcomes the lead back. The notice
   *  already said the listing is gone, so this never says so again. */
  anchored?: { title: string; noun: string } | null;
}): string {
  const { contactName, enquiry, listings, question } = args;
  const name = firstName(contactName);
  const opener = args.anchored
    ? `Thanks, ${name} 👍 Let's find you another ${args.anchored.noun} like *${args.anchored.title}*.`
    : args.reEngaged
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
    const where = args.outside
      ? args.outside.widened
        ? `nothing new is live near ${args.outside.locality} right now, so ${count} from elsewhere in our inventory:`
        : `nothing new in ${args.outside.locality} itself right now, but ${count} close by:`
      : `${count} from our inventory:`;
    const lead = args.anchored
      ? `Looking at what is live now, ${where}`
      : `Based on ${anchor}, ${where}`;
    return [
      opener,
      '',
      lead,
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

  const nothing = args.anchored
    ? `Nothing live right now fits that brief exactly, but I'll keep watching and message you the moment the right ${args.anchored.noun} comes in.`
    : `Nothing live right now fits ${anchor} exactly, but I'll keep watching and message you the moment the right property comes in.`;
  return [
    opener,
    '',
    nothing,
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
  /** The WhatsApp id of the template the lead tapped, when Meta sent
   *  one: the strongest signal of which listing the tap is about. */
  contextMessageId?: string | null;
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

    let row = contact as Contact;
    const property = await resolveTappedListing({
      db,
      accountId,
      contact: row,
      conversationId,
      contextMessageId: args.contextMessageId ?? null,
    });
    if (property) {
      const seed = await seedRequirementFromListing({
        db,
        accountId,
        contact: row,
        property,
      });
      if (seed) row = { ...row, ...seed };
    }

    const hadMissingIntent = nextQualifierForContact(row) === 'intent';
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

    const notes = (row.contact_notes ?? [])
      .map((n) => extractEnquiredPropertyFromNote(n.note_text))
      .filter(Boolean) as string[];

    const missing = nextQualifierForContact(row, {
      defaultBuying: defaultedBuying,
    });
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
              // The intent the brief now has, not the snapshot loaded
              // before applyDefaultBuyingIntent wrote it: a lead just
              // assumed to be buying is not shown rentals as near-misses.
              listingTypes: defaultedBuying
                ? ['Sale']
                : (row.pref_listing_types ?? []),
              budgetMin: row.pref_budget_min ?? row.min_budget ?? null,
              budgetMax: row.pref_budget_max ?? row.max_budget ?? null,
            },
          })
        : Promise.resolve(null),
    ]);
    const contactName = row.name ?? null;

    const areas = [...(row.areas_of_interest ?? []), ...(row.pref_areas ?? [])];
    const outsideLocality =
      strictMatches.length > 0
        ? shortlistOutsideLocality(areas, matches)
        : matches.length > 0
          ? namedLocality(areas)
          : null;

    const enquired = property ? describeEnquiredProperty(property) : null;
    const anchored =
      property && !isListingLive(property)
        ? { title: enquired as string, noun: listingNoun(property.type) }
        : null;
    const buyingNote = defaultedBuying
      ? "I'll assume you're buying; reply “renting” if needed. "
      : '';

    const text = buildPreferenceTapReply({
      contactName,
      enquiry: enquired ?? notes[0] ?? null,
      listings: buildListingLines(contactName, matches, baseUrl, contactId),
      reEngaged: isReEngagedLead(row.created_at),
      nearMiss,
      showcaseUrl,
      outside: outsideLocality
        ? { locality: outsideLocality, widened: strictMatches.length === 0 }
        : null,
      anchored,
      question:
        matches.length === 0
          ? `${buyingNote}${NEXT_STEPS_CLOSING}`
          : missing
            ? `${buyingNote}${buildFollowUpQuestion(missing)}`
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
    } else if (result.success) {
      // The menu carries the form row, so the closing line points down
      // and the turn stays at two bubbles.
      formOffered = await sendPreferenceNextStepsPrompt({
        db,
        accountId,
        userId,
        contactId,
        conversationId,
        listing: property
          ? {
              id: property.id,
              title: property.title,
              type: property.type,
              city: property.city,
            }
          : null,
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

/**
 * The listing the tap is about, as a full row, or null when nothing in
 * the quoted template, the thread or the recorded enquiry names one.
 * Never throws: the reply still goes out against the contact as filed.
 */
async function resolveTappedListing(args: {
  db: SupabaseClient;
  accountId: string;
  contact: Contact;
  conversationId: string;
  contextMessageId: string | null;
}): Promise<Property | null> {
  try {
    const dropped = await resolveDroppedProperty({
      db: args.db,
      accountId: args.accountId,
      contact: {
        id: args.contact.id,
        last_inquired_property_id: args.contact.last_inquired_property_id,
      },
      conversationId: args.conversationId,
      contextMessageId: args.contextMessageId,
    });
    if (!dropped) return null;
    const { data } = await args.db
      .from('properties')
      .select('*')
      .eq('id', dropped.id)
      .eq('account_id', args.accountId)
      .maybeSingle();
    return (data as Property | null) ?? null;
  } catch (err) {
    console.error('[preference-tap] listing lookup failed:', err);
    return null;
  }
}
