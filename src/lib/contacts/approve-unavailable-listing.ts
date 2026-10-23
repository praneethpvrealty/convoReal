import type { SupabaseClient } from '@supabase/supabase-js';
import { findConversation } from '@/lib/conversations/resolve';
import {
  listingAvailabilityNotice,
  unavailableListingReply,
} from '@/lib/inventory/listing-status';
import { accountShowcaseBrowseUrl } from '@/lib/showcase/account-showcase-url';
import {
  describeEnquiredProperty,
  ENQUIRY_NOTICE_TEMPLATE_NAMES,
} from '@/lib/whatsapp/enquiry-notice-template';
import { LISTING_AVAILABILITY_TEMPLATE_NAME } from '@/lib/whatsapp/listing-availability-template';
import { sendUnavailableListingReply } from '@/app/api/leads/email-webhook/unavailable-listing';
import { hasRequirementOnFile } from '@/lib/whatsapp/unavailable-brief-followup';
import type { Property } from '@/types';

// Approving a lead whose enquired listing has left the market.
//
// The approve action used to send the listing's details whatever its
// status, so a lead the bot had already told "no longer available" at
// import got its photos and price a few hours later. The regret goes
// instead — free-form with the lead's showcase link inside an open
// window, the approved Utility status notice outside it — and only
// once: the lead who already holds that exact reply, or the notice
// template for this listing while their window is still closed, hears
// nothing again.

export type ApproveUnavailableNotice =
  'freeform' | 'template' | 'already_told' | 'none' | 'failed';

export interface ApproveUnavailableOutcome {
  status: string;
  label: string;
  notice: ApproveUnavailableNotice;
  conversationId: string | null;
  /** The regret with the showcase link — what went out free-form, or
   *  what a hand-off carries when nothing could. */
  message: string;
}

const NOTICE_TEMPLATE_NAMES = [
  ...ENQUIRY_NOTICE_TEMPLATE_NAMES,
  LISTING_AVAILABILITY_TEMPLATE_NAME,
];

export async function tellApprovedLeadListingUnavailable(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  contactName: string | null;
  property: Property;
}): Promise<ApproveUnavailableOutcome | null> {
  const { db, accountId, userId, contactId, contactName, property } = args;
  if (!unavailableListingReply(contactName, property.title, property.status))
    return null;

  const [showcaseUrl, conversation, briefOnFile] = await Promise.all([
    accountShowcaseBrowseUrl(db, accountId, contactId),
    findConversation<{ id: string }>(db, {
      accountId,
      contactId,
      columns: 'id',
    }),
    hasRequirementOnFile(db, accountId, contactId),
  ]);
  const message = unavailableListingReply(
    contactName,
    property.title,
    property.status,
    showcaseUrl,
    briefOnFile
  )!;
  const status = (property.status ?? '').trim();
  const label = listingAvailabilityNotice(status)?.label ?? status;

  let toldByTemplate = false;
  if (conversation) {
    const [{ data: sameReply }, { data: noticeRows }] = await Promise.all([
      db
        .from('messages')
        .select('id')
        .eq('conversation_id', conversation.id)
        .eq('content_text', message)
        .neq('status', 'failed')
        .limit(1)
        .maybeSingle(),
      db
        .from('messages')
        .select('content_text')
        .eq('conversation_id', conversation.id)
        .eq('content_type', 'template')
        .in('template_name', NOTICE_TEMPLATE_NAMES)
        .neq('status', 'failed'),
    ]);
    if (sameReply) {
      return {
        status,
        label,
        notice: 'already_told',
        conversationId: conversation.id,
        message,
      };
    }
    const described = describeEnquiredProperty(property);
    toldByTemplate = ((noticeRows ?? []) as { content_text?: string }[]).some(
      (row) => (row.content_text ?? '').includes(described)
    );
  }

  const outcome = await sendUnavailableListingReply({
    supabase: db,
    accountId,
    userId,
    contactId,
    conversationId: conversation?.id ?? null,
    leadName: contactName ?? '',
    propertyId: property.id,
    templateFallback: !toldByTemplate,
  });
  if (outcome === 'available') return null;

  const conversationId =
    conversation?.id ??
    (
      await findConversation<{ id: string }>(db, {
        accountId,
        contactId,
        columns: 'id',
      })
    )?.id ??
    null;
  return {
    status,
    label,
    notice:
      outcome === 'text'
        ? 'freeform'
        : outcome === 'template'
          ? 'template'
          : outcome === 'window_closed'
            ? 'already_told'
            : outcome === 'no_template'
              ? 'none'
              : 'failed',
    conversationId,
    message,
  };
}
