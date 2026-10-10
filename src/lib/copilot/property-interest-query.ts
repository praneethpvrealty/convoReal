import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeEntitySearchQuery } from './entities';
import {
  PROPERTY_INTEREST_LIMIT,
  type InterestContact,
  type InterestProperty,
  type PropertyInterestMatch,
  type PropertyInterestQuery,
  type PropertyInterestResult,
} from './property-interest';

interface SearchContext {
  supabase: SupabaseClient;
  accountId: string;
}

interface InterestRow {
  property_id: string;
  property_title: string | null;
  property_code: string | null;
  contact_id: string;
  name: string | null;
  second_name: string | null;
  company: string | null;
  classification: string | null;
  enquired: boolean | null;
  views_count: number | string | null;
  shortlisted: boolean | null;
  visited: boolean | null;
  liked: boolean | null;
  journey_stage: string | null;
  journey_status: string | null;
  last_at: string | null;
  total: number | string | null;
}

interface PropertyRow {
  id: string;
  title: string | null;
  property_code: string | null;
  owner: { name: string | null; second_name: string | null } | null;
}

interface ContactRow {
  id: string;
  name: string | null;
  second_name: string | null;
  company: string | null;
  classification: string | null;
}

const SUBJECT_LIMIT = 5;

function toNumber(value: number | string | null): number {
  if (value == null) return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
}

function contactLabel(row: {
  name: string | null;
  second_name: string | null;
  company: string | null;
}): string {
  return (
    [row.name, row.second_name].filter(Boolean).join(' ').trim() ||
    row.company?.trim() ||
    'Unnamed contact'
  );
}

function likeProbe(value: string): string | null {
  const clean = sanitizeEntitySearchQuery(value)
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return clean ? clean : null;
}

function probeTokens(value: string): string[] {
  const clean = likeProbe(value);
  if (!clean) return [];
  const tokens = clean
    .split(' ')
    .filter(
      (token) =>
        token.length >= 2 &&
        !/^(?:the|and|for|with|near|from|in|at|on|of)$/.test(token)
    );
  return (tokens.length ? tokens : [clean]).slice(0, 6);
}

function mapProperty(row: PropertyRow): InterestProperty {
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  return {
    id: row.id,
    title: row.title,
    code: row.property_code,
    ownerName: owner
      ? [owner.name, owner.second_name].filter(Boolean).join(' ').trim() || null
      : null,
  };
}

const PROPERTY_SELECT =
  'id, title, property_code, owner:contacts!properties_owner_contact_id_fkey(name, second_name)';

async function contactsNamed(
  ctx: SearchContext,
  name: string
): Promise<ContactRow[]> {
  const probe = likeProbe(name);
  if (!probe) return [];
  let request = ctx.supabase
    .from('contacts')
    .select('id, name, second_name, company, classification')
    .eq('account_id', ctx.accountId)
    .is('merged_into_id', null)
    .or('chain_only.is.null,chain_only.eq.false')
    .order('updated_at', { ascending: false })
    .limit(SUBJECT_LIMIT);
  for (const token of probeTokens(probe)) {
    request = request.ilike('copilot_search_text', `%${token}%`);
  }
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ContactRow[];
  const exact = rows.filter((row) =>
    new RegExp(
      `(^|\\s)${probe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i'
    ).test(contactLabel(row))
  );
  return exact.length ? exact : rows;
}

async function propertiesOwnedBy(
  ctx: SearchContext,
  ownerIds: string[]
): Promise<InterestProperty[]> {
  if (!ownerIds.length) return [];
  const { data, error } = await ctx.supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('account_id', ctx.accountId)
    .in('owner_contact_id', ownerIds.slice(0, SUBJECT_LIMIT))
    .order('updated_at', { ascending: false })
    .limit(SUBJECT_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PropertyRow[]).map(mapProperty);
}

async function propertiesById(
  ctx: SearchContext,
  ids: string[]
): Promise<InterestProperty[]> {
  if (!ids.length) return [];
  const { data, error } = await ctx.supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('account_id', ctx.accountId)
    .in('id', ids.slice(0, SUBJECT_LIMIT));
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PropertyRow[]).map(mapProperty);
}

async function propertiesMatching(
  ctx: SearchContext,
  probe: string
): Promise<InterestProperty[]> {
  const tokens = probeTokens(probe);
  if (!tokens.length) return [];
  let request = ctx.supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('account_id', ctx.accountId)
    .order('updated_at', { ascending: false })
    .limit(SUBJECT_LIMIT);
  for (const token of tokens) {
    request = request.ilike('copilot_search_text', `%${token}%`);
  }
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PropertyRow[]).map(mapProperty);
}

async function resolveProperties(
  ctx: SearchContext,
  query: PropertyInterestQuery
): Promise<InterestProperty[]> {
  if (query.propertyIds.length) return propertiesById(ctx, query.propertyIds);
  if (query.ownerContactIds.length) {
    return propertiesOwnedBy(ctx, query.ownerContactIds);
  }
  if (query.ownerName) {
    const owners = await contactsNamed(ctx, query.ownerName);
    const owned = await propertiesOwnedBy(
      ctx,
      owners.map((owner) => owner.id)
    );
    if (owned.length) return owned;
    return propertiesMatching(ctx, query.ownerName);
  }
  if (query.propertyProbe) return propertiesMatching(ctx, query.propertyProbe);
  return [];
}

async function resolveContacts(
  ctx: SearchContext,
  query: PropertyInterestQuery
): Promise<InterestContact[]> {
  let rows: ContactRow[] = [];
  if (query.contactIds.length) {
    const { data, error } = await ctx.supabase
      .from('contacts')
      .select('id, name, second_name, company, classification')
      .eq('account_id', ctx.accountId)
      .in('id', query.contactIds.slice(0, SUBJECT_LIMIT));
    if (error) throw new Error(error.message);
    rows = (data ?? []) as ContactRow[];
  } else if (query.contactName) {
    rows = await contactsNamed(ctx, query.contactName);
  }
  return rows.map((row) => ({
    id: row.id,
    label: contactLabel(row),
    classification: row.classification,
  }));
}

export async function findCopilotPropertyInterest(
  ctx: SearchContext,
  query: PropertyInterestQuery
): Promise<PropertyInterestResult> {
  const properties =
    query.direction === 'contacts' ? await resolveProperties(ctx, query) : [];
  const contacts =
    query.direction === 'properties' ? await resolveContacts(ctx, query) : [];
  const empty = { properties, contacts, matches: [], total: 0 };
  if (query.direction === 'contacts' && !properties.length && !query.across) {
    return empty;
  }
  if (query.direction === 'properties' && !contacts.length) return empty;

  const { data, error } = await ctx.supabase.rpc('copilot_property_interest', {
    p_account_id: ctx.accountId,
    p_property_ids: properties.map((property) => property.id),
    p_contact_ids: contacts.map((contact) => contact.id),
    p_since: query.since,
    p_signal: query.signal,
    p_limit: PROPERTY_INTEREST_LIMIT,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InterestRow[];
  const matches: PropertyInterestMatch[] = rows.map((row) => ({
    propertyId: row.property_id,
    propertyTitle: row.property_title,
    propertyCode: row.property_code,
    contactId: row.contact_id,
    label: contactLabel(row),
    classification: row.classification,
    enquired: Boolean(row.enquired),
    viewsCount: toNumber(row.views_count),
    shortlisted: Boolean(row.shortlisted),
    visited: Boolean(row.visited),
    liked: Boolean(row.liked),
    journeyStage: row.journey_stage,
    journeyStatus: row.journey_status,
    lastAt: row.last_at,
  }));
  return {
    properties,
    contacts,
    matches,
    total: toNumber(rows[0]?.total ?? 0),
  };
}
