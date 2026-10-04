import type { TypedSupabaseClient } from '@/lib/supabase/database';
import type {
  CallLog,
  Contact,
  ContactNote,
  Deal,
  Property,
  ShowcaseSettings,
  Tag,
} from '@/types';
import {
  scanMessagesForProperties,
  type ScannableMessage,
} from '@/lib/journey/chat-scan';
import { ilikeAcross, ilikeTerm } from '@/lib/v1/query';

type DB = TypedSupabaseClient;

export interface ContactDetailBundle {
  contact: Contact;
  inquiredProperty: Property | null;
  portalAdLink: { property_id: string } | null;
  inquiredProperties: Property[];
}

export interface ContactTagsBundle {
  allTags: Tag[];
  contactTagIds: string[];
  pinnedTagIds: string[];
}

export type PropertyMessageStatus = Record<
  string,
  { sent: boolean; responded: boolean; lastSentAt: string | null }
>;

export const PROPERTY_PICKER_COLUMNS =
  'id, title, property_code, location, sublocality, city, state, project, tags, price, type, status, bedrooms, area_sqft, area_unit, images';

export type PickerProperty = Pick<
  Property,
  | 'id'
  | 'title'
  | 'property_code'
  | 'location'
  | 'sublocality'
  | 'city'
  | 'state'
  | 'project'
  | 'tags'
  | 'price'
  | 'type'
  | 'status'
  | 'bedrooms'
  | 'area_sqft'
  | 'area_unit'
  | 'images'
>;

export type SharedProperty = PickerProperty & { sharedAt: string };

export const REFERRER_CANDIDATE_COLUMNS =
  'id, name, second_name, name_tag, phone, classification';

export const REFERRER_SUGGESTION_LIMIT = 5;

export type ReferrerCandidate = Pick<
  Contact,
  'id' | 'name' | 'second_name' | 'name_tag' | 'phone' | 'classification'
>;

export const PARTY_CANDIDATE_COLUMNS = 'id, name, second_name, name_tag, phone';

export type PartyCandidate = Pick<
  Contact,
  'id' | 'name' | 'second_name' | 'name_tag' | 'phone'
>;

export async function loadDetailShowcaseSettings(
  db: DB
): Promise<ShowcaseSettings | null> {
  try {
    const { data } = await db
      .from('showcase_settings')
      .select('*')
      .maybeSingle();
    return (data as ShowcaseSettings | null) ?? null;
  } catch (err) {
    console.error('Failed to load showcase settings:', err);
    return null;
  }
}

export async function loadAllProperties(db: DB): Promise<PickerProperty[]> {
  const { data } = await db
    .from('properties')
    .select(PROPERTY_PICKER_COLUMNS)
    .order('title');
  return (data ?? []) as PickerProperty[];
}

export function referrerSearchClauses(term: string): string[] {
  const cleaned = ilikeTerm(term.replace(/["\\]/g, ' '));
  if (!cleaned) return [];
  return cleaned
    .split(' ')
    .map((word) =>
      ilikeAcross(['name', 'second_name', 'phone'], word.replace(/_/g, '\\\\_'))
    );
}

export async function searchReferrerCandidates(
  db: DB,
  accountId: string,
  term: string,
  excludeContactId: string
): Promise<ReferrerCandidate[]> {
  const clauses = referrerSearchClauses(term);
  if (clauses.length === 0) return [];
  let query = db
    .from('contacts')
    .select(REFERRER_CANDIDATE_COLUMNS)
    .eq('account_id', accountId)
    .neq('id', excludeContactId);
  for (const clause of clauses) query = query.or(clause);
  const { data, error } = await query
    .order('name')
    .limit(REFERRER_SUGGESTION_LIMIT);
  if (error) throw error;
  return (data ?? []) as ReferrerCandidate[];
}

export async function loadPartyCandidates(
  db: DB,
  accountId: string
): Promise<PartyCandidate[]> {
  const { data, error } = await db
    .from('contacts')
    .select(PARTY_CANDIDATE_COLUMNS)
    .eq('account_id', accountId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as PartyCandidate[];
}

export async function loadContactDetail(
  db: DB,
  contactId: string
): Promise<ContactDetailBundle> {
  const { data, error } = await db
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .single();

  if (!data) throw new Error(error?.message ?? 'Contact not found');

  // Fetch last inquired property details (for backward compatibility)
  let inquiredProperty: Property | null = null;
  if (data.last_inquired_property_id) {
    const { data: propData } = await db
      .from('properties')
      .select('*')
      .eq('id', data.last_inquired_property_id)
      .maybeSingle();
    inquiredProperty = (propData as Property | null) || null;
  }

  // Is the portal ad this lead quoted already mapped to a listing?
  // A mapped ad needs no assertion — the webhook resolved this lead
  // through it, and will resolve every later one the same way.
  let portalAdLink: { property_id: string } | null = null;
  if (data.lead_portal && data.lead_portal_listing_id) {
    const { data: primaryLink } = await db
      .from('property_portal_listings')
      .select('property_id')
      .eq('portal', data.lead_portal)
      .eq('portal_listing_id', data.lead_portal_listing_id)
      .maybeSingle();
    const { data: aliasLink } = primaryLink
      ? { data: null }
      : await db
          .from('property_portal_listing_aliases')
          .select('property_id')
          .eq('portal', data.lead_portal)
          .eq('portal_listing_id', data.lead_portal_listing_id)
          .maybeSingle();
    portalAdLink = primaryLink ?? aliasLink ?? null;
  }

  // Fetch all inquired properties from junction table
  const { data: inquiries } = await db
    .from('contact_property_inquiries')
    .select('property_id')
    .eq('contact_id', contactId);

  let inquiredProperties: Property[] = [];
  if (inquiries && inquiries.length > 0) {
    const propertyIds = inquiries.map((i) => i.property_id);
    const { data: props } = await db
      .from('properties')
      .select('*')
      .in('id', propertyIds);
    inquiredProperties = (props as Property[] | null) || [];
  }

  return {
    contact: data as Contact,
    inquiredProperty,
    portalAdLink,
    inquiredProperties,
  };
}

export async function loadAssociatedProperties(
  db: DB,
  contactId: string
): Promise<Property[]> {
  const { data, error } = await db
    .from('properties')
    .select('*')
    .eq('owner_contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching associated properties:', error);
    throw error;
  }
  return (data as Property[] | null) || [];
}

export async function loadPropertyMessageStatus(
  db: DB,
  contactId: string,
  inquiredProperties: Property[]
): Promise<PropertyMessageStatus> {
  // Fetch all messages in conversations with this contact
  const { data: conversations } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId);

  if (!conversations || conversations.length === 0) return {};

  const conversationIds = conversations.map((c) => c.id);
  const { data: messages } = await db
    .from('messages')
    .select('content_text, sender_type, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: true });

  if (!messages || messages.length === 0) return {};

  // Build status map for each property
  const statusMap: PropertyMessageStatus = {};

  inquiredProperties.forEach((prop) => {
    const searchTerms = [
      prop.title?.toLowerCase(),
      prop.property_code?.toLowerCase(),
      prop.location?.toLowerCase(),
    ].filter(Boolean);

    let lastSentAt: string | null = null;
    let hasResponse = false;

    messages.forEach((msg, idx) => {
      const content = (msg.content_text || '').toLowerCase();
      const isPropertyMentioned = searchTerms.some(
        (term) => term && content.includes(term)
      );

      if (isPropertyMentioned && msg.sender_type === 'agent') {
        lastSentAt = msg.created_at;
        // Check if there's any inbound message after this outbound message
        const laterMessages = messages.slice(idx + 1);
        hasResponse = laterMessages.some((m) => m.sender_type === 'customer');
      }
    });

    statusMap[prop.id] = {
      sent: lastSentAt !== null,
      responded: hasResponse,
      lastSentAt,
    };
  });

  return statusMap;
}

export async function loadSharedProperties(
  db: DB,
  contactId: string,
  allProperties: PickerProperty[]
): Promise<SharedProperty[]> {
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .maybeSingle();

  if (!conv) return [];

  const { data: messages, error } = await db
    .from('messages')
    .select('content_text, created_at')
    .eq('conversation_id', conv.id)
    .eq('sender_type', 'agent')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Shared scan logic with /journey's "Import from chat"
  // (src/lib/journey/chat-scan.ts): matches by showcase
  // property_id link, property code, or long exact title.
  const found = scanMessagesForProperties(
    (messages ?? []) as ScannableMessage[],
    allProperties
  );
  const sharedProps: SharedProperty[] = [];
  found.forEach((sharedAt, propId) => {
    const prop = allProperties.find((p) => p.id === propId);
    if (prop) sharedProps.push({ ...prop, sharedAt });
  });

  return sharedProps;
}

export async function loadContactTags(
  db: DB,
  contactId: string
): Promise<ContactTagsBundle> {
  const [tagsRes, contactTagsRes] = await Promise.all([
    db.from('tags').select('*').order('name'),
    db.from('contact_tags').select('tag_id').eq('contact_id', contactId),
  ]);

  const ids = (contactTagsRes.data ?? []).map((ct) => ct.tag_id);
  return {
    allTags: (tagsRes.data ?? []) as Tag[],
    contactTagIds: ids,
    // Snapshot for ordering only. Pinned at load rather than tracking
    // contactTagIds, so toggling a tag doesn't slide the next one out
    // from under the cursor mid-click.
    pinnedTagIds: ids,
  };
}

export async function loadContactNotes(
  db: DB,
  contactId: string
): Promise<ContactNote[]> {
  const { data } = await db
    .from('contact_notes')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  return (data ?? []) as ContactNote[];
}

export async function loadContactDeals(
  db: DB,
  contactId: string
): Promise<Deal[]> {
  const { data } = await db
    .from('deals')
    .select('*, stage:pipeline_stages(*)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Deal[];
}

export async function loadContactCalls(contactId: string): Promise<CallLog[]> {
  const res = await fetch(`/api/contacts/${contactId}/calls`);
  if (!res.ok) throw new Error('Failed to load calls');
  const data = await res.json();
  return data.calls ?? [];
}
