// What "Close my enquiry" closes.
//
// The button sits on templates that each name one listing, so the
// close is scoped to that listing: it is rejected for this contact,
// its journey branch is dropped, and the lead hears one short
// acknowledgement — nothing else. A lead who has just closed an
// enquiry is not asked why, not pitched alerts and not walked through
// their other enquiries: every one of those followed the close once,
// and a buyer whose deal had just fallen through was asked "what made
// you drop it?" and sold a listing engine in the same minute.
//
// Only when nothing names a listing and nothing is on the journey is
// the close read as the lead ending their search. That is the one case
// that marks the contact dead, and the goodbye's START ALERTS revives
// them.

import type { SupabaseClient } from '@supabase/supabase-js';
import { markContactDead } from '@/lib/contacts/lifecycle';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  resolveDroppedProperty,
  type DroppedProperty,
} from '@/lib/whatsapp/enquiry-dropoff';
import {
  closePropertyEnquiry,
  enquiryLabel,
  loadOpenEnquiries,
  sendEnquiryReview,
} from '@/lib/whatsapp/enquiry-review';

export const START_ALERTS_LINE =
  'If you would like to hear about new listings that match your requirement later, just reply START ALERTS.';

export function buildPropertyCloseAck(args: {
  property: DroppedProperty;
  openCount: number;
}): string {
  const label = enquiryLabel(args.property);
  return [
    `Understood — your enquiry on *${label}* is closed, and you will not get further updates on it.`,
    ...(args.openCount > 0
      ? ['', 'Your other enquiries with us stay open.']
      : []),
  ].join('\n');
}

export function buildSearchCloseAck(): string {
  return [
    'Understood — your enquiry is closed, and this is our last update. Thank you for considering us.',
    '',
    START_ALERTS_LINE,
    '',
    'We wish you the very best with your search!',
  ].join('\n');
}

export type EnquiryCloseOutcome = 'property' | 'review' | 'search';

/**
 * Handles the "Close my enquiry" tap end to end. Never throws — the
 * lead asked for an acknowledgement, and a failure in the follow-up
 * must not turn into silence.
 */
export async function handleEnquiryClose(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contact: {
    id: string;
    name?: string | null;
    last_inquired_property_id?: string | null;
    buyer_alerts_consent?: 'pending' | 'granted' | 'declined';
  };
  conversationId: string;
  contextMessageId: string | null;
}): Promise<EnquiryCloseOutcome> {
  const { db, accountId, userId, contact, conversationId } = args;
  const send = (text: string) =>
    sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId: contact.id,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
      allowDeadContact: true,
      customDbClient: db,
    });

  try {
    const property = await resolveDroppedProperty({
      db,
      accountId,
      contact,
      conversationId,
      contextMessageId: args.contextMessageId,
    });

    if (property) {
      await closePropertyEnquiry({ db, accountId, contact, property });
      const open = await loadOpenEnquiries(db, accountId, contact.id);
      await send(buildPropertyCloseAck({ property, openCount: open.length }));
      return 'property';
    }

    const open = await loadOpenEnquiries(db, accountId, contact.id);
    if (open.length > 0) {
      await sendEnquiryReview({
        db,
        accountId,
        userId,
        contactId: contact.id,
        conversationId,
        acknowledgement:
          'Understood — that enquiry is closed, and you will not get further updates on it.',
        enquiries: open,
      });
      return 'review';
    }

    await markContactDead({
      db,
      accountId,
      contactId: contact.id,
      reason: 'closed_enquiry',
      note: 'Lead closed their enquiry from WhatsApp ("Close my enquiry")',
    });
    await send(buildSearchCloseAck());
    return 'search';
  } catch (err) {
    console.error('[enquiry-close] failed:', err);
    return 'search';
  }
}
