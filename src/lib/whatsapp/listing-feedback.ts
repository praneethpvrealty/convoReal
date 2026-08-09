// Interested / Not-for-me capture on listings the bot sends.
//
// A listings message asks for a typed reply; most leads never type.
// This follows each shortlist with one tap-to-expand list — interested
// in a specific listing, or none of them fit — and every tap is filed
// on listing_feedback, where rankings read it back: a rejected
// property never reaches that contact again, an interested one pings
// the agent while the lead is still in the chat.
//
// A rejection is worth more with a reason, so "none of these fit" is
// answered with a second one-tap list (budget / location / type /
// size). Each reason ends with a pointed question the qualification
// ladder can parse from a bare reply — the checkbox form, rebuilt out
// of the two interactive shapes WhatsApp actually has.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';
import { sendPreferenceFlowToContact } from '@/lib/whatsapp/meta-flow-service';
import { createNotification } from '@/lib/notifications/create';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import type { RankedPropertyMatch } from '@/lib/radar/engine';

/** Every id this module owns starts with this. */
export const LISTING_FEEDBACK_ID_PREFIX = 'lfb';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS = ['budget', 'location', 'type', 'size', 'other'] as const;
type RejectReason = (typeof REASONS)[number];

const REASON_ROWS: { reason: RejectReason; title: string }[] = [
  { reason: 'budget', title: 'Budget too high' },
  { reason: 'location', title: 'Wrong location' },
  { reason: 'type', title: 'Wrong property type' },
  { reason: 'size', title: "Size didn't work" },
  { reason: 'other', title: 'Something else' },
];

/** The follow-up each reason earns — a pointed question answerable by
 *  replying, which the qualification ladder files as an answer. */
const REASON_QUESTION: Record<RejectReason, string> = {
  budget:
    "Got it — I'll stay inside your budget. What's the most you'd want to spend?",
  location:
    'Got it — which areas should I focus on instead? Name one or two localities.',
  type: 'Got it — what should I look for instead: plot, apartment, villa or commercial?',
  size: 'Got it — what size works for you? Sq.ft or number of bedrooms, either is fine.',
  other:
    "Tell me what to change — budget, area, type, anything — and I'll tune your matches.",
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The one-tap list that follows a shortlist. One row per listing shown,
 * one for "none of these fit", and optionally one that opens the full
 * preference form — so the form stays reachable without being its own
 * message.
 */
export function buildListingFeedbackSections(
  matches: RankedPropertyMatch[],
  opts: { includeFormRow?: boolean } = {}
): InteractiveListSection[] {
  const shown = matches.slice(0, 3);
  const ids = shown.map((m) => m.property.id);
  const rows = shown.map((m, i) => ({
    id: `lfb_y_${m.property.id}`,
    title: `Interested in ${i + 1}`,
    description: truncate(m.property.title || '', 72),
  }));
  rows.push({
    id: `lfb_n_${ids.join('.')}`,
    title: 'None of these fit',
    description: "One tap and I'll tune what reaches you",
  });
  if (opts.includeFormRow) {
    rows.push({
      id: 'lfb_form',
      title: 'Update preferences',
      description: 'Full form — takes under a minute',
    });
  }
  return [{ rows }];
}

/**
 * Sends the feedback list after a shortlist went out. Never throws —
 * the listings message already landed, and this must not undo that.
 */
export async function sendListingFeedbackPrompt(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  matches: RankedPropertyMatch[];
  includeFormRow?: boolean;
}): Promise<boolean> {
  if (args.matches.length === 0) return false;
  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody:
        'Quick check — do any of these work for you? One tap trains your matches.',
      interactiveButtonLabel: 'Pick one',
      interactiveSections: buildListingFeedbackSections(args.matches, {
        includeFormRow: args.includeFormRow,
      }),
      customDbClient: args.db,
    });
    return result.success;
  } catch (err) {
    console.error('[listing-feedback] prompt send failed:', err);
    return false;
  }
}

function firstName(name: string | null | undefined): string {
  return isPlaceholderLeadName(name) ? 'there' : name!.trim().split(/\s+/)[0];
}

/** Ids arrive from the webhook, so nothing embedded in them is
 *  trusted: parse strictly and keep only well-formed UUIDs. */
function parsePropertyIds(raw: string): string[] {
  return raw
    .split('.')
    .filter((id) => UUID_RE.test(id))
    .slice(0, 3);
}

/**
 * Routes a tapped lfb_* reply id. Returns true when the tap was
 * consumed (reply sent, feedback recorded); false for ids this module
 * does not own, letting the webhook fall through to other handlers.
 */
export async function handleListingFeedbackReply(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contact: { id: string; name?: string | null };
  conversationId: string;
  replyId: string;
}): Promise<boolean> {
  const { db, accountId, configOwnerUserId, contact, conversationId, replyId } =
    args;

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
    if (replyId === 'lfb_form') {
      const result = await sendPreferenceFlowToContact({
        accountId,
        contactId: contact.id,
        senderType: 'bot',
        db,
      });
      if (!result.success) {
        console.error(`[listing-feedback] form send failed: ${result.error}`);
        await send(
          "Just tell me what changed — budget, areas, property type — and I'll update your preferences right here."
        );
      }
      return true;
    }

    if (replyId.startsWith('lfb_y_')) {
      const propertyId = replyId.slice('lfb_y_'.length);
      if (!UUID_RE.test(propertyId)) return false;

      // Account-scoped read: the id came over the wire, so a property
      // outside this account records nothing.
      const { data: property } = await db
        .from('properties')
        .select('id, title, user_id')
        .eq('id', propertyId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (!property) return false;

      await db.from('listing_feedback').upsert(
        {
          account_id: accountId,
          contact_id: contact.id,
          property_id: propertyId,
          verdict: 'interested',
          reason: null,
        },
        { onConflict: 'contact_id,property_id' }
      );

      await send(
        `Great choice 👌 I've flagged your interest in *${property.title}* — our team will reach out shortly with photos and next steps. Want a site visit? Just say when.`
      );

      const { data: contactRow } = await db
        .from('contacts')
        .select('assigned_agent_id')
        .eq('id', contact.id)
        .eq('account_id', accountId)
        .maybeSingle();

      // Interest is perishable — ping the human while the lead is
      // still in the chat.
      await createNotification({
        accountId,
        userId:
          (contactRow?.assigned_agent_id as string | null) ??
          (property.user_id as string | null) ??
          configOwnerUserId,
        type: 'listing_interest',
        title: `${firstName(contact.name)} is interested in a listing`,
        body: `${contact.name || 'A lead'} tapped "Interested" on ${property.title}. They're expecting photos and next steps.`,
        entityType: 'conversation',
        entityId: conversationId,
        link: '/inbox',
      });
      return true;
    }

    if (replyId.startsWith('lfb_n_')) {
      const ids = parsePropertyIds(replyId.slice('lfb_n_'.length));
      if (ids.length === 0) return false;

      const { data: owned } = await db
        .from('properties')
        .select('id')
        .eq('account_id', accountId)
        .in('id', ids);
      const ownedIds = (owned ?? []).map((p) => p.id as string);

      if (ownedIds.length > 0) {
        await db.from('listing_feedback').upsert(
          ownedIds.map((propertyId) => ({
            account_id: accountId,
            contact_id: contact.id,
            property_id: propertyId,
            verdict: 'rejected',
          })),
          { onConflict: 'contact_id,property_id' }
        );
      }

      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contact.id,
        conversationId,
        kind: 'interactive',
        senderType: 'bot',
        interactiveType: 'list',
        interactiveBody:
          "No problem — those are off your list and won't come back. What didn't fit? One tap helps me tune your matches.",
        interactiveButtonLabel: 'Tell me',
        interactiveSections: [
          {
            rows: REASON_ROWS.map((r) => ({
              id: `lfbr_${r.reason}_${ownedIds.join('.')}`,
              title: r.title,
            })),
          },
        ],
        customDbClient: db,
      });
      return true;
    }

    if (replyId.startsWith('lfbr_')) {
      const rest = replyId.slice('lfbr_'.length);
      const sep = rest.indexOf('_');
      const reason = (sep === -1 ? rest : rest.slice(0, sep)) as RejectReason;
      if (!REASONS.includes(reason)) return false;

      const ids = sep === -1 ? [] : parsePropertyIds(rest.slice(sep + 1));
      if (ids.length > 0) {
        await db
          .from('listing_feedback')
          .update({ reason })
          .eq('account_id', accountId)
          .eq('contact_id', contact.id)
          .eq('verdict', 'rejected')
          .in('property_id', ids);
      }

      await send(REASON_QUESTION[reason]);
      return true;
    }

    return false;
  } catch (err) {
    console.error('[listing-feedback] reply handling failed:', err);
    // The tap was ours even if recording failed; a fall-through would
    // hand a feedback tap to handlers that cannot make sense of it.
    return true;
  }
}
