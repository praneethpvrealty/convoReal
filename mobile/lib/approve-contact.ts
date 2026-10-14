// Approve a pending lead: flip them active and send the details of the
// property they inquired about over WhatsApp.
//
// One call to POST /api/contacts/[id]/approve. This used to be six
// sequential round trips from the phone — contact update, property
// load, showcase settings, conversation lookup, handoff clear, then the
// send — each paying mobile latency on top of the work. The route now
// does all of it in one hop and returns everything the celebration
// sheet needs.

import { ApiError, apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  buildInquiryDetailsMessage,
  propertyShowcaseUrl,
} from '@/lib/share-message';
import { getShowcaseUrl } from '@/lib/welcome-message';
import type { Contact, Property } from '@/lib/types';

export type UnavailableListingNotice =
  'freeform' | 'template' | 'already_told' | 'none' | 'failed';

export interface UnavailableListingOutcome {
  status: string;
  /** "Under contract", "Sold", "No longer listed" — for the copy. */
  label: string;
  /** How the regret reached them: free text with the showcase link,
   *  the approved status notice, nothing because they already hold it,
   *  nothing because the window is closed and no notice is approved,
   *  or a failed send. */
  notice: UnavailableListingNotice;
}

export interface ApproveOutcome {
  ok: boolean;
  /** Property details — or, for a listing that has left the market,
   *  the regret — went out over WhatsApp. */
  sent: boolean;
  /** How they went out: the composed free text (window open) or the
   *  approved property template (window closed). */
  channel?: 'freeform' | 'template';
  /** The property the contact inquired about, when there is one — so
   *  the celebration/thread can show and re-send it. */
  property?: Property;
  /** The drafted details message (complete specs + showcase link) —
   *  what went out on send, or what wa.me should carry on re-engage. */
  detailsMessage?: string;
  /** Session >24h with no approved template — send one from this
   *  conversation instead. */
  reengageConversationId?: string;
  /** Set when the enquired listing has left the market: the lead was
   *  told so (or already had been) instead of being sent its details. */
  unavailable?: UnavailableListingOutcome;
  error?: string;
}

interface ApproveResponse {
  data: {
    approved: boolean;
    sent: boolean;
    channel?: 'freeform' | 'template';
    property?: Property;
    details_message?: string;
    conversation_id?: string | null;
    template_status?: string;
    unavailable?: UnavailableListingOutcome;
    send_error?: string;
  };
}

/** Complete details + showcase link for a property id — used by the
 *  conversation seed draft, which composes without approving. */
export async function buildInquiryDraft(
  propertyId: string
): Promise<{ property: Property; message: string } | null> {
  // The listing and the showcase base don't depend on each other.
  const [{ data }, base] = await Promise.all([
    supabase.from('properties').select('*').eq('id', propertyId).maybeSingle(),
    getShowcaseUrl(),
  ]);
  if (!data) return null;
  const property = data as Property;
  return {
    property,
    message: buildInquiryDetailsMessage({
      property,
      url: propertyShowcaseUrl(base, property),
    }),
  };
}

export async function approveAndSendDetails(
  contact: Contact
): Promise<ApproveOutcome> {
  try {
    const res = await apiFetch<ApproveResponse>(
      `/api/contacts/${contact.id}/approve`,
      { method: 'POST' }
    );
    const d = res.data;

    return {
      ok: true,
      sent: d.sent,
      channel: d.channel,
      property: d.property,
      detailsMessage: d.details_message,
      // Nothing went out and the window is shut: the celebration offers
      // the thread's template picker for this conversation. A lead who
      // already holds the regret needs nothing sent again.
      ...(!d.sent &&
      d.conversation_id &&
      d.unavailable?.notice !== 'already_told'
        ? { reengageConversationId: d.conversation_id }
        : {}),
      ...(d.unavailable ? { unavailable: d.unavailable } : {}),
      ...(d.send_error ? { error: d.send_error } : {}),
    };
  } catch (err) {
    // The approval itself did not land — the row is untouched, so the
    // caller can safely offer a retry.
    return {
      ok: false,
      sent: false,
      error:
        err instanceof ApiError
          ? err.message
          : 'Failed to approve this contact',
    };
  }
}
