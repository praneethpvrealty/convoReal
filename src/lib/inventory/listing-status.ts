import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import { listingTitleForMessage } from '@/lib/inventory/listing-title';
export {
  type ListingAvailabilityNotice,
  listingAvailabilityNotice,
  listingStatusInquiryLine,
  listingStatusNote,
  appendListingStatusNote,
  type UnavailableShareChoice,
  type UnavailableSharePrompt,
  unavailableListingSharePrompt,
  listingStatusCaveat,
  listingAvailabilityContext,
  listingStatusAgentLine,
} from './listing-availability';

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

/** Whether a listing may be volunteered — offered to a buyer who did not
 *  ask for it by a match alert, a catalog card or a shortlist — or
 *  asked about once they drop it. Only a listing explicitly published
 *  and still Available qualifies: a status the row never set reads as
 *  Available, but is_published must be true, since the column is
 *  nullable with a false default and a null is an unpublished row. */
export function isListingLive(listing: {
  status?: string | null;
  is_published?: boolean | null;
}): boolean {
  return (
    (listing.status ?? 'Available') === 'Available' &&
    listing.is_published === true
  );
}

const ENQUIRY_STATUS_PHRASES: Record<string, string> = {
  'Under Contract': 'currently under contract with another buyer',
  'Off Market': 'off the market for now',
  Archived: 'not actively listed at the moment',
  Rejected: 'not actively listed at the moment',
};

export const UNAVAILABLE_LISTING_AGENT_NOTE =
  'The buyer was told the listing is not available and asked for their requirements and budget — follow up with matching options.';

/** The line every dead-end reply ends on: whatever the bot could not
 *  find, the buyer can always browse the live catalogue themselves. */
export function showcaseBrowseLine(showcaseUrl: string): string {
  return `Browse every live listing any time: ${showcaseUrl}`;
}

export function unavailableListingReply(
  contactName: string | null | undefined,
  propertyTitle: string | null | undefined,
  status: string | null | undefined,
  showcaseUrl?: string | null
): string | null {
  const value = (status ?? '').trim();
  if (!value || value === 'Available' || value === 'Pending Review')
    return null;
  const first = leadFirstName(contactName);
  const greeting = first ? `Hi ${first}, thank you` : 'Hi, thank you';
  const title = listingTitleForMessage(propertyTitle);
  const subject = title ? `*${title}*` : 'this property';
  const nudge =
    "Please share your requirements and budget, and I'll send you the best matching options.";
  const browse = showcaseUrl ? `\n\n${showcaseBrowseLine(showcaseUrl)}` : '';
  if (value === 'Sold') {
    return `${greeting} for your interest in ${subject}. I'm sorry — this property has already been sold. I'd be glad to find you something similar. ${nudge}${browse}`;
  }
  const phrase =
    ENQUIRY_STATUS_PHRASES[value] ?? `marked ${value.toLowerCase()} right now`;
  return `${greeting} for your interest in ${subject}. I'm sorry — this property is ${phrase}. If it becomes available again, we'll come back and update you right here. Meanwhile, ${nudge.charAt(0).toLowerCase()}${nudge.slice(1)}${browse}`;
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
