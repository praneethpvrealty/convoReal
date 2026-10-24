import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePropertyGroup } from '@/lib/matching';
import {
  isMatchRejectReason,
  suggestPropertyTypeOption,
  type MatchFeedbackMark,
} from '@/lib/match-feedback';
import type { Property } from '@/types';

/** The most recent contacts with a type rejection that get a suggestion
 *  worked out — the bound on the enquiry lookup's id list. */
const SUGGESTION_CONTACT_CAP = 100;

export interface ListingMatchFeedback {
  /** Every rejection on file for this listing, one per contact. */
  marks: MatchFeedbackMark[];
  /** contact id → suggested PROPERTY_TYPE_OPTIONS id. Callers show it
   *  only for a contact whose type is not on file. */
  suggestions: Record<string, string>;
}

type PropertyRef = Pick<Property, 'type' | 'title'>;

interface FeedbackRow {
  contact_id: string;
  verdict: string;
  reason: string | null;
  properties: PropertyRef | PropertyRef[] | null;
}

interface InquiryRow {
  contact_id: string;
  properties: PropertyRef | PropertyRef[] | null;
}

function groupOf(ref: PropertyRef | PropertyRef[] | null): string | null {
  const property = Array.isArray(ref) ? ref[0] : ref;
  return property ? resolvePropertyGroup(property) : null;
}

/**
 * The rejections behind a listing's Matching Contacts list and the type
 * suggestions for the contacts they teach about. Best-effort: a failed
 * read returns no marks, which renders the list as it was before marks
 * existed rather than failing it.
 */
export async function loadListingMatchFeedback(
  db: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<ListingMatchFeedback> {
  const empty: ListingMatchFeedback = { marks: [], suggestions: {} };

  const { data: listingRows, error: listingError } = await db
    .from('listing_feedback')
    .select('contact_id, reason, source, created_at')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .eq('verdict', 'rejected');
  if (listingError) {
    console.error('[match-feedback] listing read failed:', listingError);
    return empty;
  }

  const marks: MatchFeedbackMark[] = (listingRows ?? []).map((row) => ({
    contactId: row.contact_id as string,
    reason: isMatchRejectReason(row.reason) ? row.reason : null,
    source: row.source === 'agent' ? 'agent' : 'contact',
    createdAt: row.created_at as string,
  }));

  const { data: signalRows, error: signalError } = await db
    .from('listing_feedback')
    .select('contact_id, verdict, reason, properties(type, title)')
    .eq('account_id', accountId)
    .or('reason.eq.type,verdict.eq.interested')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (signalError) {
    console.error('[match-feedback] signal read failed:', signalError);
    return { marks, suggestions: {} };
  }

  const rejected = new Map<string, string[]>();
  const interested = new Map<string, string[]>();
  for (const row of (signalRows ?? []) as unknown as FeedbackRow[]) {
    const group = groupOf(row.properties);
    if (!group) continue;
    const bucket =
      row.verdict === 'rejected' && row.reason === 'type'
        ? rejected
        : row.verdict === 'interested'
          ? interested
          : null;
    if (!bucket) continue;
    bucket.set(row.contact_id, [...(bucket.get(row.contact_id) ?? []), group]);
  }

  const contactIds = [...rejected.keys()].slice(0, SUGGESTION_CONTACT_CAP);
  if (contactIds.length === 0) return { marks, suggestions: {} };

  const { data: inquiryRows, error: inquiryError } = await db
    .from('contact_property_inquiries')
    .select('contact_id, properties(type, title)')
    .eq('account_id', accountId)
    .in('contact_id', contactIds)
    .limit(1000);
  if (inquiryError) {
    console.error('[match-feedback] enquiry read failed:', inquiryError);
  }
  for (const row of (inquiryRows ?? []) as unknown as InquiryRow[]) {
    const group = groupOf(row.properties);
    if (!group) continue;
    interested.set(row.contact_id, [
      ...(interested.get(row.contact_id) ?? []),
      group,
    ]);
  }

  const suggestions: Record<string, string> = {};
  for (const contactId of contactIds) {
    const option = suggestPropertyTypeOption({
      rejectedGroups: rejected.get(contactId) ?? [],
      interestedGroups: interested.get(contactId) ?? [],
    });
    if (option) suggestions[contactId] = option.id;
  }
  return { marks, suggestions };
}
