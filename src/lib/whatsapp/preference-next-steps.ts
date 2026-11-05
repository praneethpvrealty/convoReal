// The menu a lead gets when "Update my preferences" finds nothing.
//
// Before this, a no-match tap reply ended on one typed question and a
// second bubble pushing the form the lead had just declined to fill.
// The thread this replaces: a lead whose enquiry named a residential
// plot was asked "land/plot, apartment, villa or commercial?" and then
// offered "Update my preferences" a second time. Interest is not the
// leak; the dead end is.
//
// So the no-match reply ends on one tappable list of concrete next
// moves. Four rows reuse handlers that already exist — the budget band
// list (tw_budget), the typed area question (tw_area), the property
// type list (tw_type) and the preference form (lfb_form) — and two are
// this module's own: the nearest fits from elsewhere in the city, and
// a call back from the agent, filed as a to-do and an alert the way a
// showcase check-in's "Call me back" is.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/types';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  rankPropertiesForContact,
  generateMatchEventForContact,
} from '@/lib/radar/engine';
import { logListingsSent } from '@/lib/whatsapp/share-property-send';
import { sendListingFeedbackPrompt } from '@/lib/whatsapp/listing-feedback';
import {
  MAX_MATCHES_SENT,
  buildListingLines,
} from '@/lib/ai/buyer-qualification';
import {
  accountShowcaseBrowseUrl,
  accountShowcaseOrigin,
} from '@/lib/showcase/account-showcase-url';
import { showcaseBrowseLine } from '@/lib/inventory/listing-status';
import { listingTitleForMessage } from '@/lib/inventory/listing-title';
import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import { PROPERTY_TYPE_OPTIONS } from '@/lib/match-feedback';
import { resolveAssignedAgent } from '@/lib/voice/assigned-agent';
import { createNotification } from '@/lib/notifications/create';

/** Every id this module owns starts with this. */
export const PREFERENCE_NEXT_STEP_ID_PREFIX = 'ns_';
const WIDEN_ID_PREFIX = 'ns_widen_';
const CALLBACK_ID_PREFIX = 'ns_callback_';
/** The row's tail when no listing anchors the menu. */
const NO_LISTING = 'any';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Meta caps list row titles at 24 characters. */
const MAX_ROW_TITLE = 24;
const CALLBACK_TODO_DUE_MS = 60 * 60 * 1000;

export type NextStepsListing = Pick<Property, 'id' | 'title' | 'type'> & {
  city?: string | null;
};

const GROUP_NOUNS: Record<string, string> = {
  'residential-plot': 'plot',
  apartment: 'apartment',
  house: 'house',
  'commercial-space': 'commercial space',
  'commercial-plot': 'commercial plot',
  agricultural: 'land parcel',
  industrial: 'industrial property',
};

/** "plot", "apartment", "villa" — how the reply names the kind of
 *  property the lead enquired about. */
export function listingNoun(type: string | null | undefined): string {
  const cleaned = type?.trim() ?? '';
  if (!cleaned) return 'property';
  if (/villa/i.test(cleaned)) return 'villa';
  if (/farm\s*house/i.test(cleaned)) return 'farm house';
  const option = PROPERTY_TYPE_OPTIONS.find(
    (o) => !o.staffOnly && o.types.includes(cleaned)
  );
  const group = option?.groups[0];
  if (group && GROUP_NOUNS[group]) return GROUP_NOUNS[group];
  if (/plot|land|site/i.test(cleaned)) return 'plot';
  return 'property';
}

function plural(noun: string): string {
  if (noun.endsWith('y')) return `${noun.slice(0, -1)}ies`;
  return noun.endsWith('s') ? noun : `${noun}s`;
}

function elsewhereTitle(city: string | null | undefined): string {
  const named = city?.trim();
  const title = named ? `Elsewhere in ${named}` : 'Elsewhere in the city';
  return title.length <= MAX_ROW_TITLE ? title : 'Elsewhere in the city';
}

export function buildPreferenceNextStepsSections(args: {
  listing: NextStepsListing | null;
  includeFormRow?: boolean;
}): InteractiveListSection[] {
  const noun = listingNoun(args.listing?.type);
  const many = plural(noun);
  const tail = args.listing?.id ?? NO_LISTING;
  const rows: InteractiveListSection['rows'] = [
    {
      id: 'tw_budget',
      title: 'Stretch my budget',
      description: `${many[0].toUpperCase()}${many.slice(1)} nearby at a higher price`,
    },
    {
      id: `${WIDEN_ID_PREFIX}${tail}`,
      title: elsewhereTitle(args.listing?.city),
      description: `The nearest ${many} like it, any area`,
    },
    {
      id: 'tw_area',
      title: 'A different area',
      description: 'Name the locality to search',
    },
    {
      id: 'tw_type',
      title: 'A different type',
      description: 'Apartment, villa, plot or commercial',
    },
    {
      id: `${CALLBACK_ID_PREFIX}${tail}`,
      title: 'Call me back',
      description: args.listing
        ? 'An agent calls you about this enquiry'
        : 'An agent calls you about your search',
    },
  ];
  if (args.includeFormRow) {
    rows.push({
      id: 'lfb_form',
      title: 'Update the full form',
      description: 'Everything in one place, under a minute',
    });
  }
  return [{ rows }];
}

export const NEXT_STEPS_BODY = 'What should I try next? Pick one below.';

/** Sends the menu. Never throws — the no-match reply already landed,
 *  and a failed menu must not undo it. */
export async function sendPreferenceNextStepsPrompt(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  listing: NextStepsListing | null;
  includeFormRow?: boolean;
  bodyText?: string;
}): Promise<boolean> {
  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody: args.bodyText ?? NEXT_STEPS_BODY,
      interactiveButtonLabel: 'Choose',
      interactiveSections: buildPreferenceNextStepsSections({
        listing: args.listing,
        includeFormRow: args.includeFormRow,
      }),
      customDbClient: args.db,
    });
    return result.success;
  } catch (err) {
    console.error('[preference-next-steps] menu send failed:', err);
    return false;
  }
}

export function parsePreferenceNextStepId(
  replyId: string
): { step: 'widen' | 'callback'; propertyId: string | null } | null {
  const prefix = replyId.startsWith(WIDEN_ID_PREFIX)
    ? WIDEN_ID_PREFIX
    : replyId.startsWith(CALLBACK_ID_PREFIX)
      ? CALLBACK_ID_PREFIX
      : null;
  if (!prefix) return null;
  const tail = replyId.slice(prefix.length);
  // The id came over the wire: anything but a well-formed UUID or the
  // "no listing" marker is not ours.
  if (tail !== NO_LISTING && !UUID_RE.test(tail)) return null;
  return {
    step: prefix === WIDEN_ID_PREFIX ? 'widen' : 'callback',
    propertyId: tail === NO_LISTING ? null : tail,
  };
}

export function buildWidenReply(args: {
  listings: string[];
  noun: string;
  showcaseUrl: string | null;
}): string {
  const many = plural(args.noun);
  const browse = args.showcaseUrl ? [showcaseBrowseLine(args.showcaseUrl)] : [];
  if (args.listings.length === 0) {
    return [
      `Nothing like it is live anywhere in our inventory right now, so I'd rather not send you ${many} that don't fit.`,
      '',
      ...browse,
      ...(browse.length ? [''] : []),
      "I'll message you the moment one comes in. If something else would work — a different type, size or budget — just reply here.",
    ].join('\n');
  }
  const count =
    args.listings.length === 1
      ? 'the closest fit'
      : `the ${args.listings.length} closest fits`;
  return [
    `Here's ${count} from elsewhere in our inventory:`,
    '',
    args.listings.join('\n\n'),
    '',
    ...browse,
    ...(browse.length ? [''] : []),
    "Want photos or a site visit for any of these? Reply with the number and I'll set it up.",
  ].join('\n');
}

export function buildCallbackAck(args: {
  firstName: string;
  agentName: string | null;
  propertyTitle: string | null;
}): string {
  const who = args.agentName || 'Our team';
  const about = args.propertyTitle
    ? ` about *${args.propertyTitle}*`
    : ' about your search';
  return `Thanks ${args.firstName}! ${who} will call you back shortly${about}. If there's a better time to reach you, just reply here.`;
}

/**
 * Routes an ns_* tap. Returns true when the tap was consumed; false for
 * ids this module does not own, so the webhook falls through.
 */
export async function handlePreferenceNextStepReply(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contact: { id: string; name?: string | null; phone?: string | null };
  conversationId: string;
  replyId: string;
}): Promise<boolean> {
  const parsed = parsePreferenceNextStepId(args.replyId);
  if (!parsed) return false;
  const { db, accountId, configOwnerUserId, contact, conversationId } = args;

  const send = (text: string) =>
    sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contact.id,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
      customDbClient: db,
    });

  try {
    const property = parsed.propertyId
      ? ((
          await db
            .from('properties')
            .select('id, title, type, user_id')
            .eq('id', parsed.propertyId)
            .eq('account_id', accountId)
            .maybeSingle()
        ).data as Pick<Property, 'id' | 'title' | 'type' | 'user_id'> | null)
      : null;

    if (parsed.step === 'widen') {
      const matches = await rankPropertiesForContact(
        db,
        accountId,
        contact.id,
        {
          anyLocation: true,
          excludeAlreadySent: true,
        }
      );
      const [baseUrl, showcaseUrl] = await Promise.all([
        accountShowcaseOrigin(db, accountId),
        accountShowcaseBrowseUrl(db, accountId, contact.id),
      ]);
      const result = await send(
        buildWidenReply({
          listings: buildListingLines(
            contact.name,
            matches,
            baseUrl,
            contact.id
          ),
          noun: listingNoun(property?.type),
          showcaseUrl,
        })
      );
      if (matches.length > 0 && result.success) {
        await logListingsSent(
          db,
          accountId,
          configOwnerUserId,
          contact.id,
          matches.slice(0, MAX_MATCHES_SENT).map((m) => m.property.id)
        );
        await sendListingFeedbackPrompt({
          db,
          accountId,
          userId: configOwnerUserId,
          contactId: contact.id,
          conversationId,
          matches,
          includeFormRow: true,
        });
        void generateMatchEventForContact(db, accountId, contact.id).catch(
          (err) => {
            console.error('[preference-next-steps] radar event failed:', err);
          }
        );
      }
      return true;
    }

    const { data: contactRow } = await db
      .from('contacts')
      .select('assigned_agent_id, phone')
      .eq('id', contact.id)
      .eq('account_id', accountId)
      .maybeSingle();
    const agentUserId =
      (contactRow?.assigned_agent_id as string | null) ??
      property?.user_id ??
      configOwnerUserId;
    const agent = await resolveAssignedAgent(db, accountId, agentUserId).catch(
      () => null
    );
    const propertyTitle = property?.title
      ? listingTitleForMessage(property.title)
      : null;

    const ack = await send(
      buildCallbackAck({
        firstName: leadFirstName(contact.name),
        agentName: agent?.name?.split(/\s+/)[0] || null,
        propertyTitle,
      })
    );

    const contactName = contact.name?.trim() || 'A lead';
    const contactPhone =
      (contactRow?.phone as string | null) || contact.phone || 'no number';
    const about = propertyTitle ? ` about ${propertyTitle}` : '';
    const { error: todoError } = await db.from('todos').insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      assigned_to: agentUserId,
      title: `Call back ${contactName}${about}`,
      due_date: new Date(Date.now() + CALLBACK_TODO_DUE_MS).toISOString(),
      priority: 'high',
      completed: false,
      contact_id: contact.id,
      source: 'system',
    });
    if (todoError) {
      console.error('[preference-next-steps] to-do insert failed:', todoError);
    }
    await createNotification({
      accountId,
      userId: agentUserId,
      type: 'listing_interest',
      eventKey: 'showcase_viewer_response',
      title: `Call back ${contactName}`,
      body: `${contactName} (${contactPhone}) tapped "Call me back" on WhatsApp${about ? `${about}` : ''}. Call them within the hour.${
        ack.success
          ? ''
          : " Our WhatsApp confirmation to them didn't go through, so reach out directly."
      }`,
      entityType: 'conversation',
      entityId: conversationId,
      link: `/inbox?conversation=${conversationId}`,
    });
    return true;
  } catch (err) {
    console.error('[preference-next-steps] tap handling failed:', err);
    // The tap was ours; falling through would hand it to handlers that
    // cannot make sense of it.
    return true;
  }
}
