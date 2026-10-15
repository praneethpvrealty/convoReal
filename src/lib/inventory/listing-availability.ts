/**
 * The wording for a listing that is not Available, shared by the bot's
 * replies, the web share dialog and the mobile share sheet. Mobile
 * bundles this file through `@shared/`, so it imports nothing.
 */

export interface ListingAvailabilityNotice {
  status: string;
  label: string;
  message: string;
}

const UNAVAILABLE_PHRASES: Record<string, { label: string; phrase: string }> = {
  'Under Contract': {
    label: 'Under contract',
    phrase:
      'currently under contract with another buyer, but the deal is not closed yet',
  },
  Sold: { label: 'Sold', phrase: 'already sold' },
  'Off Market': { label: 'Off market', phrase: 'off the market for now' },
  Archived: { label: 'No longer listed', phrase: 'no longer actively listed' },
  Rejected: { label: 'No longer listed', phrase: 'no longer actively listed' },
  'Pending Review': {
    label: 'Awaiting verification',
    phrase: 'still being verified, so its details may change',
  },
};

function unavailablePhrase(status: string | null | undefined) {
  const value = (status ?? '').trim();
  if (!value || value === 'Available') return null;
  return (
    UNAVAILABLE_PHRASES[value] ?? {
      label: value,
      phrase: `marked ${value.toLowerCase()} and may not be available`,
    }
  );
}

export function listingAvailabilityNotice(
  status: string | null | undefined
): ListingAvailabilityNotice | null {
  const entry = unavailablePhrase(status);
  if (!entry) return null;
  return {
    status: (status ?? '').trim(),
    label: entry.label,
    message: `This property is ${entry.phrase}. You can still check with the listing owner for the latest status.`,
  };
}

export function listingStatusInquiryLine(
  status: string | null | undefined
): string | null {
  const notice = listingAvailabilityNotice(status);
  if (!notice) return null;
  return `I see it is marked "${notice.status}" — could you share its latest status?`;
}

export function listingStatusNote(
  status: string | null | undefined
): string | null {
  const entry = unavailablePhrase(status);
  if (!entry) return null;
  return `Please note: this property is ${entry.phrase}. Our team will check the latest status with the owner and update you here.`;
}

export function appendListingStatusNote(
  text: string,
  status: string | null | undefined
): string {
  const note = listingStatusNote(status);
  return note ? `${text}\n\n${note}` : text;
}

export type UnavailableShareChoice = 'with_note' | 'without_note';

export interface UnavailableSharePrompt {
  status: string;
  label: string;
  title: string;
  message: string;
  note: string;
}

/** The question the share dialog and the mobile share sheet put to an
 *  agent before a listing that has left the market goes out by hand:
 *  whether to share it at all, and whether the message should carry
 *  the availability note the bot would have sent. The agent sees the
 *  exact note so the choice is between two known messages. */
export function unavailableListingSharePrompt(
  status: string | null | undefined
): UnavailableSharePrompt | null {
  const notice = listingAvailabilityNotice(status);
  const note = listingStatusNote(status);
  if (!notice || !note) return null;
  return {
    status: notice.status,
    label: notice.label,
    title: `This listing is ${notice.label.toLowerCase()} — share it anyway?`,
    message: notice.message,
    note,
  };
}

/** The caveat that rides on any other answer about an unavailable
 *  listing, so a buyer told its price is also told it is not for sale. */
export function listingStatusCaveat(
  status: string | null | undefined
): string | null {
  const entry = unavailablePhrase(status);
  if (!entry) return null;
  return `Please note: this property is ${entry.phrase}.`;
}

/** What the model is told about availability, worded so it cannot be
 *  read as a sale listing that is open. */
export function listingAvailabilityContext(
  status: string | null | undefined
): string {
  const entry = unavailablePhrase(status);
  if (!entry) return 'Available';
  const value = (status ?? '').trim();
  return value === 'Pending Review'
    ? 'Not yet confirmed — the listing is still being verified'
    : `NOT available — ${entry.phrase}`;
}

export function listingStatusAgentLine(
  status: string | null | undefined
): string | null {
  const notice = listingAvailabilityNotice(status);
  if (!notice) return null;
  return `⚠️ Listing is marked "${notice.status}" — confirm the latest status with the owner before promising a visit.`;
}
