import { leadFirstName } from '@/lib/contacts/lead-placeholder';

/**
 * Which listings the proactive senders are still allowed to talk about.
 *
 * A listing that leaves the market keeps every row that references it —
 * enquiries, deals, shares, showcase views — so a digest that scans
 * `properties` will happily keep reporting buyer activity on a flat that
 * sold weeks ago, and ask its former owner whether they would like
 * updates about it. The scanning senders (owner digest, agent reach
 * digest, deal-mode sweep) filter on the list below. Reactive paths that
 * answer something a user just did are deliberately unaffected — a sold
 * property still has an owner who can request its documents.
 */

export const CLOSED_LISTING_STATUSES = [
  'Sold',
  'Off Market',
  'Archived',
  'Rejected',
];

/** PostgREST `not.in` operand — the multi-word statuses need quoting. */
export const CLOSED_LISTING_STATUS_FILTER = `("${CLOSED_LISTING_STATUSES.join('","')}")`;

export function isListingClosed(status: string | null | undefined): boolean {
  return !!status && CLOSED_LISTING_STATUSES.includes(status);
}

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

export function appendListingStatusNote(
  text: string,
  status: string | null | undefined
): string {
  const entry = unavailablePhrase(status);
  if (!entry) return text;
  return `${text}\n\nPlease note: this property is ${entry.phrase}. Our team will check the latest status with the owner and update you here.`;
}

const ENQUIRY_STATUS_PHRASES: Record<string, string> = {
  'Under Contract': 'currently under contract with another buyer',
  'Off Market': 'off the market for now',
  Archived: 'not actively listed at the moment',
  Rejected: 'not actively listed at the moment',
};

export const UNAVAILABLE_LISTING_AGENT_NOTE =
  'The buyer was told the listing is not available and asked for their requirements and budget — follow up with matching options.';

export function unavailableListingReply(
  contactName: string | null | undefined,
  propertyTitle: string | null | undefined,
  status: string | null | undefined
): string | null {
  const value = (status ?? '').trim();
  if (!value || value === 'Available' || value === 'Pending Review')
    return null;
  const first = leadFirstName(contactName);
  const greeting = first ? `Hi ${first}, thank you` : 'Hi, thank you';
  const subject = propertyTitle?.trim()
    ? `*${propertyTitle.trim()}*`
    : 'this property';
  const nudge =
    "Please share your requirements and budget, and I'll send you the best matching options.";
  if (value === 'Sold') {
    return `${greeting} for your interest in ${subject}. I'm sorry — this property has already been sold. I'd be glad to find you something similar. ${nudge}`;
  }
  const phrase =
    ENQUIRY_STATUS_PHRASES[value] ?? `marked ${value.toLowerCase()} right now`;
  return `${greeting} for your interest in ${subject}. I'm sorry — this property is ${phrase}. If it becomes available again, we'll come back and update you right here. Meanwhile, ${nudge.charAt(0).toLowerCase()}${nudge.slice(1)}`;
}

/**
 * The one-line answer to "is this still available?", whatever surface
 * asked it. The Q&A ladder serves it before any matcher or model call
 * so a listing's status is never guessed from "Listing: Sale" alone.
 */
export function listingAvailabilityAnswer(
  status: string | null | undefined,
  listingType?: string | null
): string {
  const value = (status ?? '').trim();
  const nudge =
    "Please share your requirements and budget, and I'll send you the best matching options.";
  if (!value || value === 'Available') {
    const forWhat =
      listingType === 'Rent'
        ? 'for rent'
        : listingType === 'Built to Suit'
          ? 'as a Built to Suit lease'
          : listingType === 'JV/JD'
            ? 'for joint development'
            : 'for sale';
    return `Yes, this property is currently available ${forWhat}.`;
  }
  if (value === 'Pending Review') {
    return "This listing is still being verified, so I can't confirm its availability just yet. I'll update you here as soon as it is confirmed.";
  }
  if (value === 'Sold') {
    return `I'm sorry — this property has already been sold. I'd be glad to find you something similar. ${nudge}`;
  }
  const phrase =
    ENQUIRY_STATUS_PHRASES[value] ?? `marked ${value.toLowerCase()} right now`;
  return `I'm sorry — this property is ${phrase}. If it becomes available again, we'll update you right here. Meanwhile, ${nudge.charAt(0).toLowerCase()}${nudge.slice(1)}`;
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
