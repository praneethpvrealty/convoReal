// What "Close my enquiry" closes.
//
// The button sits on templates that each name one listing, so the
// close is scoped to that listing: it is rejected for this contact,
// its journey branch is dropped, and the lead is told exactly that —
// their other enquiries stay open, the requirement keeps matching, and
// alert consent is whatever they last said. Then the tap's open window
// does the rest: the drop-off reason for that listing, a review of the
// enquiries still open, and the requirement ladder.
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
  sendEnquiryDropoffPrompt,
  type DroppedProperty,
} from '@/lib/whatsapp/enquiry-dropoff';
import {
  closePropertyEnquiry,
  enquiryLabel,
  loadOpenEnquiries,
  sendEnquiryReview,
} from '@/lib/whatsapp/enquiry-review';

export const ALERTS_PITCH =
  'Our listing engine keeps matching every new property against your requirement the moment it arrives — and when a seller needs a quick exit, it sometimes catches a real steal deal, priced well under market. If you would like it quietly watching for you, just reply START ALERTS.';

export function buildPropertyCloseAck(args: {
  property: DroppedProperty;
  openCount: number;
  alertsGranted: boolean;
}): string {
  const label = enquiryLabel(args.property);
  const others =
    args.openCount === 0
      ? null
      : args.openCount === 1
        ? 'That only closes this one listing — your other enquiry with us stays open.'
        : `That only closes this one listing — your other ${args.openCount} enquiries with us stay open.`;
  return [
    `Understood — your enquiry on *${label}* is closed, and you will not get further updates on it.`,
    ...(others ? ['', others] : []),
    ...(args.alertsGranted ? [] : ['', ALERTS_PITCH]),
  ].join('\n');
}

export function buildSearchCloseAck(): string {
  return [
    'Understood — your enquiry is closed, and this is our last update. Thank you for considering us.',
    '',
    ALERTS_PITCH,
    '',
    'Otherwise, we wish you the very best with your search!',
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
      await send(
        buildPropertyCloseAck({
          property,
          openCount: open.length,
          alertsGranted: contact.buyer_alerts_consent === 'granted',
        })
      );
      await sendEnquiryDropoffPrompt({
        db,
        accountId,
        userId,
        contactId: contact.id,
        conversationId,
        property,
      });
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
