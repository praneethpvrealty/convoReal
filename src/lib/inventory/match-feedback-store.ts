import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePropertyGroup } from '@/lib/matching';
import {
  SUGGESTION_CONTACT_CAP,
  isMatchRejectReason,
  suggestPropertyTypeOption,
  type MatchFeedbackMark,
} from '@/lib/match-feedback';
import type { Property } from '@/types';

export interface ListingMatchFeedback {
  /** Every rejection on file for this listing, one per contact. */
  marks: MatchFeedbackMark[];
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

function push(map: Map<string, string[]>, key: string, value: string) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

/**
 * The rejections behind a listing's Matching Contacts list. Best-effort:
 * a failed read returns no marks, which renders the list as it was
 * before marks existed rather than failing it.
 */
export async function loadListingMatchFeedback(
  db: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<ListingMatchFeedback> {
  const { data, error } = await db
    .from('listing_feedback')
    .select('contact_id, reason, source, created_at')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .eq('verdict', 'rejected');
  if (error) {
    console.error('[match-feedback] listing read failed:', error);
    return { marks: [] };
  }
  return {
    marks: (data ?? []).map((row) => ({
      contactId: row.contact_id as string,
      reason: isMatchRejectReason(row.reason) ? row.reason : null,
      source: row.source === 'agent' ? 'agent' : 'contact',
      createdAt: row.created_at as string,
    })),
  };
}

/**
 * The listings a contact has been ruled out for, by their own answer or
 * an agent's mark — the transpose of loadListingMatchFeedback, for
 * ranking a contact's matches. Best-effort: a failed read rules nothing
 * out.
 */
export async function loadContactRejectedPropertyIds(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<Set<string>> {
  const { data, error } = await db
    .from('listing_feedback')
    .select('property_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('verdict', 'rejected');
  if (error) {
    console.error('[match-feedback] contact read failed:', error);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.property_id as string));
}

/**
 * Type suggestions for the given contacts — the matched contacts whose
 * type is not on file, in rank order. Every signal is read for those
 * contacts alone, so a busy account's newer enquiries cannot push a
 * contact's own "wrong type" marks out of view. Contacts past
 * SUGGESTION_CONTACT_CAP get none. Best-effort: a failed read suggests
 * nothing.
 */
export async function loadTypeSuggestions(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[]
): Promise<Record<string, string>> {
  const ids = [...new Set(contactIds)].slice(0, SUGGESTION_CONTACT_CAP);
  if (ids.length === 0) return {};

  const { data: signalRows, error: signalError } = await db
    .from('listing_feedback')
    .select('contact_id, verdict, reason, properties(type, title)')
    .eq('account_id', accountId)
    .in('contact_id', ids)
    .or('reason.eq.type,verdict.eq.interested');
  if (signalError) {
    console.error('[match-feedback] signal read failed:', signalError);
    return {};
  }

  const rejected = new Map<string, string[]>();
  const interested = new Map<string, string[]>();
  for (const row of (signalRows ?? []) as unknown as FeedbackRow[]) {
    const group = groupOf(row.properties);
    if (!group) continue;
    if (row.verdict === 'rejected' && row.reason === 'type') {
      push(rejected, row.contact_id, group);
    } else if (row.verdict === 'interested') {
      push(interested, row.contact_id, group);
    }
  }

  const ruledOut = [...rejected.keys()];
  if (ruledOut.length === 0) return {};

  const { data: inquiryRows, error: inquiryError } = await db
    .from('contact_property_inquiries')
    .select('contact_id, properties(type, title)')
    .eq('account_id', accountId)
    .in('contact_id', ruledOut);
  if (inquiryError) {
    console.error('[match-feedback] enquiry read failed:', inquiryError);
  }
  for (const row of (inquiryRows ?? []) as unknown as InquiryRow[]) {
    const group = groupOf(row.properties);
    if (group) push(interested, row.contact_id, group);
  }

  const suggestions: Record<string, string> = {};
  for (const contactId of ruledOut) {
    const option = suggestPropertyTypeOption({
      rejectedGroups: rejected.get(contactId) ?? [],
      interestedGroups: interested.get(contactId) ?? [],
    });
    if (option) suggestions[contactId] = option.id;
  }
  return suggestions;
}
