import type { SupabaseClient } from '@supabase/supabase-js';
import {
  entityHref,
  entityKindForSymbol,
  sanitizeEntitySearchQuery,
  type EntityKind,
  type EntityReference,
  type EntitySuggestion,
} from './entities';

const SEARCH_CANDIDATE_LIMIT = 30;
const RESULT_LIMIT = 8;

interface SearchContext {
  supabase: SupabaseClient;
  accountId: string;
}

interface PropertyRow {
  id: string;
  title: string | null;
  property_code: string | null;
  location: string | null;
  sublocality: string | null;
  city: string | null;
  project: string | null;
  type: string | null;
  listing_type: string | null;
  status: string | null;
  price: number | string | null;
}

interface ContactRow {
  id: string;
  name: string | null;
  second_name: string | null;
  name_tag: string | null;
  company: string | null;
  phone: string | null;
  classification: string | null;
  status: string | null;
}

interface LinkedLabel {
  id: string;
  name?: string | null;
  title?: string | null;
}

interface EventRow {
  id: string;
  title: string | null;
  location: string | null;
  event_type: string | null;
  status: string | null;
  start_time: string;
  contact: LinkedLabel | LinkedLabel[] | null;
  property: LinkedLabel | LinkedLabel[] | null;
}

interface RankedSuggestion extends EntitySuggestion {
  searchText: string;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => !!part?.trim()).join(' · ');
}

function formatPrice(value: number | string | null): string | null {
  const price = typeof value === 'string' ? Number(value) : value;
  if (!price || !Number.isFinite(price)) return null;
  if (price >= 10_000_000) return `₹${(price / 10_000_000).toFixed(2)} Cr`;
  if (price >= 100_000) return `₹${(price / 100_000).toFixed(1)} L`;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(price);
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function rankSuggestions(
  suggestions: RankedSuggestion[],
  rawQuery: string
): EntitySuggestion[] {
  const query = sanitizeEntitySearchQuery(rawQuery).toLocaleLowerCase();
  return suggestions
    .map((suggestion, index) => {
      const label = suggestion.label.toLocaleLowerCase();
      const searchText = suggestion.searchText.toLocaleLowerCase();
      const rank = !query
        ? index
        : label === query
          ? 0
          : label.startsWith(query)
            ? 1
            : searchText.startsWith(query)
              ? 2
              : label.includes(query)
                ? 3
                : 4;
      return { suggestion, rank, index };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, RESULT_LIMIT)
    .map(({ suggestion }) => ({
      kind: suggestion.kind,
      id: suggestion.id,
      symbol: suggestion.symbol,
      label: suggestion.label,
      subtitle: suggestion.subtitle,
      href: suggestion.href,
      status: suggestion.status,
    }));
}

async function searchProperties(
  ctx: SearchContext,
  query: string
): Promise<EntitySuggestion[]> {
  let request = ctx.supabase
    .from('properties')
    .select(
      'id, title, property_code, location, sublocality, city, project, type, listing_type, status, price'
    )
    .eq('account_id', ctx.accountId)
    .order('updated_at', { ascending: false })
    .limit(SEARCH_CANDIDATE_LIMIT);
  if (query) request = request.ilike('copilot_search_text', `%${query}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);

  const suggestions = ((data ?? []) as PropertyRow[]).map((row) => {
    const label = row.title?.trim() || row.property_code || 'Untitled property';
    const locality = row.sublocality || row.location || row.city;
    const subtitle = joinParts([
      row.property_code,
      row.project,
      locality,
      row.listing_type || row.type,
      formatPrice(row.price),
    ]);
    return {
      kind: 'property' as const,
      id: row.id,
      symbol: '#' as const,
      label,
      subtitle,
      href: entityHref('property', row.id),
      status: row.status ?? undefined,
      searchText: joinParts([label, subtitle]),
    };
  });
  return rankSuggestions(suggestions, query);
}

async function searchContacts(
  ctx: SearchContext,
  query: string
): Promise<EntitySuggestion[]> {
  let request = ctx.supabase
    .from('contacts')
    .select(
      'id, name, second_name, name_tag, company, phone, classification, status'
    )
    .eq('account_id', ctx.accountId)
    .is('merged_into_id', null)
    .is('archived_at', null)
    .or('chain_only.is.null,chain_only.eq.false')
    .order('updated_at', { ascending: false })
    .limit(SEARCH_CANDIDATE_LIMIT);
  if (query) request = request.ilike('copilot_search_text', `%${query}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);

  const suggestions = ((data ?? []) as ContactRow[]).map((row) => {
    const label =
      [row.name, row.second_name].filter(Boolean).join(' ').trim() ||
      row.company ||
      'Unnamed contact';
    const phoneSuffix = row.phone?.replace(/\D/g, '').slice(-4);
    const subtitle = joinParts([
      row.name_tag,
      row.company,
      row.classification,
      phoneSuffix ? `•••• ${phoneSuffix}` : null,
    ]);
    return {
      kind: 'contact' as const,
      id: row.id,
      symbol: '@' as const,
      label,
      subtitle,
      href: entityHref('contact', row.id),
      status: row.status ?? undefined,
      searchText: joinParts([label, subtitle]),
    };
  });
  return rankSuggestions(suggestions, query);
}

function eventSuggestion(row: EventRow): RankedSuggestion {
  const contact = one(row.contact);
  const property = one(row.property);
  const label = row.title?.trim() || 'Calendar event';
  const subtitle = joinParts([
    formatEventTime(row.start_time),
    property?.title,
    contact?.name,
    row.location,
    row.event_type?.replace(/_/g, ' '),
  ]);
  return {
    kind: 'event',
    id: row.id,
    symbol: '&',
    label,
    subtitle,
    href: entityHref('event', row.id),
    status: row.status ?? undefined,
    searchText: joinParts([label, subtitle]),
  };
}

function eventBaseQuery(ctx: SearchContext) {
  return ctx.supabase
    .from('appointments')
    .select(
      'id, title, location, event_type, status, start_time, contact:contacts(id, name), property:properties(id, title)'
    )
    .eq('account_id', ctx.accountId);
}

async function searchEvents(
  ctx: SearchContext,
  query: string
): Promise<EntitySuggestion[]> {
  if (query) {
    const { data, error } = await eventBaseQuery(ctx)
      .ilike('copilot_search_text', `%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(SEARCH_CANDIDATE_LIMIT);
    if (error) throw new Error(error.message);
    return rankSuggestions(
      ((data ?? []) as EventRow[]).map(eventSuggestion),
      query
    );
  }

  const now = new Date().toISOString();
  const [upcoming, recent] = await Promise.all([
    eventBaseQuery(ctx)
      .gte('start_time', now)
      .order('start_time', { ascending: true })
      .limit(16),
    eventBaseQuery(ctx)
      .lt('start_time', now)
      .order('start_time', { ascending: false })
      .limit(14),
  ]);
  if (upcoming.error) throw new Error(upcoming.error.message);
  if (recent.error) throw new Error(recent.error.message);
  const rows = [...(upcoming.data ?? []), ...(recent.data ?? [])] as EventRow[];
  return rankSuggestions(rows.map(eventSuggestion), '');
}

export async function searchEntitySuggestions(
  ctx: SearchContext,
  symbol: string,
  rawQuery: string
): Promise<EntitySuggestion[]> {
  const kind = entityKindForSymbol(symbol);
  if (!kind) return [];
  const query = sanitizeEntitySearchQuery(rawQuery);
  if (kind === 'property') return searchProperties(ctx, query);
  if (kind === 'contact') return searchContacts(ctx, query);
  return searchEvents(ctx, query);
}

export async function authorizeEntityReferences(
  ctx: SearchContext,
  requested: EntityReference[]
): Promise<EntityReference[]> {
  if (!requested.length) return [];
  const idsByKind = new Map<EntityKind, string[]>();
  for (const entity of requested) {
    const ids = idsByKind.get(entity.kind) ?? [];
    ids.push(entity.id);
    idsByKind.set(entity.kind, ids);
  }

  const entries = await Promise.all(
    [...idsByKind.entries()].map(async ([kind, ids]) => {
      if (kind === 'property') {
        const { data, error } = await ctx.supabase
          .from('properties')
          .select('id, title, property_code')
          .eq('account_id', ctx.accountId)
          .in('id', ids);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          kind,
          id: row.id as string,
          label:
            (row.title as string | null)?.trim() ||
            (row.property_code as string | null) ||
            'Untitled property',
        }));
      }
      if (kind === 'contact') {
        const { data, error } = await ctx.supabase
          .from('contacts')
          .select('id, name, second_name, company')
          .eq('account_id', ctx.accountId)
          .in('id', ids)
          .is('merged_into_id', null)
          .is('archived_at', null)
          .or('chain_only.is.null,chain_only.eq.false');
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          kind,
          id: row.id as string,
          label:
            [row.name, row.second_name].filter(Boolean).join(' ').trim() ||
            (row.company as string | null) ||
            'Unnamed contact',
        }));
      }
      const { data, error } = await ctx.supabase
        .from('appointments')
        .select('id, title')
        .eq('account_id', ctx.accountId)
        .in('id', ids);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        kind,
        id: row.id as string,
        label: (row.title as string | null)?.trim() || 'Calendar event',
      }));
    })
  );
  const authorized = new Map(
    entries.flat().map((entity) => [`${entity.kind}:${entity.id}`, entity])
  );
  return requested.flatMap((entity) => {
    const canonical = authorized.get(`${entity.kind}:${entity.id}`);
    return canonical ? [canonical] : [];
  });
}
