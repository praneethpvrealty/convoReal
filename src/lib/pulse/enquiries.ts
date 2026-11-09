/**
 * The Pulse "Enquiries & requests" feed: everything a showcase visitor
 * asked for, in one list. Pure — the mobile app imports it through
 * `@shared/`, so no package, alias or Node import may appear here.
 *
 * Rows come from `pulse_enquiries` (migration 20261109101500) newest
 * first in keyset pages, the same shape as the activity feed.
 */

export const PULSE_ENQUIRY_PAGE_SIZE = 40;
export const PULSE_ENQUIRY_COUNT_DAYS = 30;

export type PulseEnquiryKind =
  | 'enquiry'
  | 'location_request'
  | 'document_request'
  | 'rating'
  | 'shortlist'
  | 'whatsapp_tap'
  | 'check_in';

export const PULSE_ENQUIRY_KINDS: PulseEnquiryKind[] = [
  'enquiry',
  'location_request',
  'document_request',
  'rating',
  'shortlist',
  'whatsapp_tap',
  'check_in',
];

export interface PulseEnquiryRow {
  kind: PulseEnquiryKind;
  id: string;
  occurred_at: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  property_id: string | null;
  property_title: string | null;
  property_code: string | null;
  detail: Record<string, unknown>;
}

export interface PulseEnquiryCursor {
  before: string;
  beforeId: string;
}

export type PulseEnquiryFilter = 'all' | PulseEnquiryKind;

export const PULSE_ENQUIRY_FILTERS: Array<{
  key: PulseEnquiryFilter;
  label: string;
}> = [
  { key: 'all', label: 'Everything' },
  { key: 'enquiry', label: 'Enquiries' },
  { key: 'location_request', label: 'Location requests' },
  { key: 'document_request', label: 'Document requests' },
  { key: 'rating', label: 'Ratings' },
  { key: 'shortlist', label: 'Shortlists' },
  { key: 'whatsapp_tap', label: 'WhatsApp taps' },
  { key: 'check_in', label: 'Check-ins' },
];

export const PULSE_ENQUIRY_KIND_LABELS: Record<PulseEnquiryKind, string> = {
  enquiry: 'Enquiries',
  location_request: 'Location requests',
  document_request: 'Document requests',
  rating: 'Ratings',
  shortlist: 'Shortlists',
  whatsapp_tap: 'WhatsApp taps',
  check_in: 'Check-ins sent',
};

const MISS_REASON_LABELS: Record<string, string> = {
  budget: 'budget',
  location: 'location',
  property_type: 'property type',
  size: 'size or layout',
  other: 'other',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Who asked: the contact when known, else the name or number typed on
 *  the request, else a guest labelled by the session it came from. */
export function pulseEnquiryVisitor(row: PulseEnquiryRow): {
  label: string;
  identified: boolean;
} {
  if (row.contact_id && (row.contact_name || row.contact_phone)) {
    return {
      label: row.contact_name || row.contact_phone || 'Contact',
      identified: true,
    };
  }
  const requester =
    text(row.detail.requester_name) || text(row.detail.requester_phone);
  if (requester) return { label: requester, identified: false };
  const session = text(row.detail.session_key);
  return {
    label: session ? `Anonymous Guest · ${session}` : 'Anonymous Guest',
    identified: false,
  };
}

/** One sentence per row, in the words the agent reads in the feed. */
export function describePulseEnquiry(row: PulseEnquiryRow): string {
  const listing = row.property_title || 'a listing';
  switch (row.kind) {
    case 'enquiry': {
      const source = text(row.detail.source);
      return source
        ? `Enquired about ${listing} via ${source}.`
        : `Enquired about ${listing}.`;
    }
    case 'location_request': {
      const status = text(row.detail.status);
      const suffix =
        status === 'approved'
          ? ' — approved.'
          : status === 'rejected'
            ? ' — declined.'
            : status === 'expired'
              ? ' — expired unanswered.'
              : ' — awaiting approval.';
      return `Requested the exact location of ${listing}${suffix}`;
    }
    case 'document_request': {
      const status = text(row.detail.status);
      const suffix =
        status === 'approved'
          ? ' — approved.'
          : status === 'rejected'
            ? ' — declined.'
            : ' — awaiting approval.';
      return `Requested the documents for ${listing}${suffix}`;
    }
    case 'rating': {
      const rating = Number(row.detail.rating);
      const reasons = Array.isArray(row.detail.miss_reasons)
        ? row.detail.miss_reasons
            .map((reason) => MISS_REASON_LABELS[String(reason)] ?? null)
            .filter((reason): reason is string => reason !== null)
        : [];
      const base = `Rated ${listing} ${Number.isFinite(rating) ? rating : '?'}/10`;
      return reasons.length
        ? `${base} — missed on ${reasons.join(', ')}.`
        : `${base}.`;
    }
    case 'shortlist':
      return `Shortlisted ${listing}.`;
    case 'whatsapp_tap':
      return row.detail.shortlist === true
        ? `Sent their shortlist including ${listing} on WhatsApp.`
        : `Tapped WhatsApp on ${listing}.`;
    case 'check_in': {
      const response = text(row.detail.response);
      return response
        ? `Check-in sent after viewing ${listing} — replied "${response}".`
        : `Check-in sent after viewing ${listing} — no reply yet.`;
    }
  }
}

/** A high rating, a shortlist, a WhatsApp tap or a reply to a check-in
 *  deserves a follow-up today; a declined request or a low rating does
 *  not. */
export function pulseEnquiryIsHot(row: PulseEnquiryRow): boolean {
  switch (row.kind) {
    case 'rating':
      return Number(row.detail.rating) >= 7;
    case 'shortlist':
    case 'whatsapp_tap':
    case 'enquiry':
      return true;
    case 'check_in':
      return Boolean(text(row.detail.response));
    case 'location_request':
    case 'document_request':
      return text(row.detail.status) === 'pending';
  }
}

export function filterPulseEnquiries(
  rows: PulseEnquiryRow[],
  filter: PulseEnquiryFilter
): PulseEnquiryRow[] {
  return filter === 'all' ? rows : rows.filter((row) => row.kind === filter);
}

/** The cursor for the page after `rows`, or null once a short page says
 *  the feed is exhausted. It carries the id as well as the time: rows
 *  filed in one transaction share a timestamp, and a page boundary that
 *  fell inside such a batch would otherwise skip the rest of it. */
export function nextPulseEnquiryCursor(
  rows: Array<Pick<PulseEnquiryRow, 'occurred_at' | 'id'>>
): PulseEnquiryCursor | null {
  if (rows.length < PULSE_ENQUIRY_PAGE_SIZE) return null;
  const last = rows[rows.length - 1];
  return last ? { before: last.occurred_at, beforeId: last.id } : null;
}

export function pulseEnquiryCountsSince(now: Date = new Date()): string {
  return new Date(
    now.getTime() - PULSE_ENQUIRY_COUNT_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

export function tallyPulseEnquiryCounts(
  rows: Array<{ kind: string; total: number | string }>
): Record<PulseEnquiryKind, number> {
  const counts = Object.fromEntries(
    PULSE_ENQUIRY_KINDS.map((kind) => [kind, 0])
  ) as Record<PulseEnquiryKind, number>;
  for (const row of rows) {
    if ((PULSE_ENQUIRY_KINDS as string[]).includes(row.kind))
      counts[row.kind as PulseEnquiryKind] = Number(row.total) || 0;
  }
  return counts;
}
