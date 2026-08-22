import { withAnalyticsTimeout } from '@/lib/analytics-request';
import { supabase } from '@/lib/supabase';

/**
 * Web parity: the Today signals that render under Focus
 * (src/lib/today/queries.ts) — reply windows, cooling leads, and the
 * day's numbers. Same client-side aggregation over the RLS-scoped
 * client; fine at the current scale, move to an RPC if a tenant
 * outgrows it.
 *
 * The day's agenda is deliberately absent: Focus owns it, and both
 * surfaces read it from GET /api/focus so the two can't disagree about
 * what today holds.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function startOfLocalDay(d: Date = new Date()): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfLocalDay(d: Date = new Date()): Date {
  const out = startOfLocalDay(d);
  out.setDate(out.getDate() + 1);
  out.setMilliseconds(-1);
  return out;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// --- Expiring WhatsApp sessions (+ awaiting-reply tail) ---------------

export interface ExpiringSession {
  conversationId: string;
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    name_tag: string | null;
  } | null;
  lastCustomerAt: string;
  expiresAt: string;
}

/**
 * Conversations whose last message is from the customer with no agent
 * or bot reply after it, inside WhatsApp's 24-hour service window,
 * sorted by window expiry.
 */
export async function fetchExpiringSessions(): Promise<ExpiringSession[]> {
  return withAnalyticsTimeout(
    fetchExpiringSessionsUnbounded(),
    'Reply-window analytics'
  );
}

async function fetchExpiringSessionsUnbounded(): Promise<ExpiringSession[]> {
  const windowStart = new Date(Date.now() - DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', windowStart)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as {
    conversation_id: string;
    sender_type: string;
    created_at: string;
  }[];

  const unreplied = new Map<string, string>();
  let curConv = '';
  let lastCustomerAt: string | null = null;
  let replied = false;
  const flush = () => {
    if (curConv && lastCustomerAt && !replied)
      unreplied.set(curConv, lastCustomerAt);
  };
  for (const row of rows) {
    if (row.conversation_id !== curConv) {
      flush();
      curConv = row.conversation_id;
      lastCustomerAt = null;
      replied = false;
    }
    if (row.sender_type === 'customer') {
      lastCustomerAt = row.created_at;
      replied = false;
    } else if (lastCustomerAt) {
      replied = true;
    }
  }
  flush();

  if (unreplied.size === 0) return [];

  const { data: convData, error: convError } = await supabase
    .from('conversations')
    .select(
      'id, status, is_archived, contact:contacts(id, name, phone, name_tag)'
    )
    .in('id', Array.from(unreplied.keys()));
  if (convError) throw convError;

  type ConvRow = {
    id: string;
    status: string;
    is_archived: boolean | null;
    contact: ExpiringSession['contact'] | ExpiringSession['contact'][] | null;
  };

  const items: ExpiringSession[] = [];
  for (const row of (convData ?? []) as unknown as ConvRow[]) {
    if (row.is_archived || row.status === 'closed') continue;
    const customerAt = unreplied.get(row.id);
    if (!customerAt) continue;
    items.push({
      conversationId: row.id,
      contact: one(row.contact),
      lastCustomerAt: customerAt,
      expiresAt: new Date(
        new Date(customerAt).getTime() + DAY_MS
      ).toISOString(),
    });
  }

  return items.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

// --- Hot leads going quiet --------------------------------------------

export interface QuietHotLead {
  id: string;
  name: string | null;
  phone: string | null;
  name_tag: string | null;
  daysSilent: number;
}

/** Stage kinds that put a relationship past the enquiry — mirrors
 *  PAST_ENQUIRY_STAGE_KINDS in src/components/journey/shared.ts. */
const PAST_ENQUIRY_STAGE_KINDS = ['closing', 'won'];

/**
 * Contacts with an active journey item on a closing or won stage. Web
 * parity: src/lib/journey/past-enquiry.ts. A buyer at legal or
 * registration is quiet because the work moved to lawyers, not because
 * they went cold, so they belong out of every "gone quiet" list.
 */
async function fetchPastEnquiryContacts(): Promise<Set<string>> {
  const { data: stages } = await supabase
    .from('journey_stages')
    .select('id')
    .in('stage_kind', PAST_ENQUIRY_STAGE_KINDS);
  const stageIds = ((stages ?? []) as { id: string }[]).map((s) => s.id);
  if (!stageIds.length) return new Set();

  const { data: items } = await supabase
    .from('journey_items')
    .select('contact_id')
    .eq('status', 'active')
    .in('stage_id', stageIds);
  return new Set(
    ((items ?? []) as { contact_id: string }[]).map((i) => i.contact_id)
  );
}

/** Active HOT leads not touched in 48h+, longest-silent first, capped
 *  at 20. Deals already at legal or registration are left out. */
export async function fetchHotGoingQuiet(): Promise<QuietHotLead[]> {
  return withAnalyticsTimeout(
    fetchHotGoingQuietUnbounded(),
    'Quiet-lead analytics'
  );
}

async function fetchHotGoingQuietUnbounded(): Promise<QuietHotLead[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, name_tag, last_contacted_at, created_at')
    .eq('is_merged', false)
    .in('status', ['active', 'pending_review'])
    .eq('lead_temp', 'HOT');
  if (error) throw error;

  const pastEnquiry = await fetchPastEnquiryContacts();

  const cutoff = Date.now() - 48 * HOUR_MS;
  const leads: QuietHotLead[] = [];
  for (const contact of (data ?? []) as {
    id: string;
    name: string | null;
    phone: string | null;
    name_tag: string | null;
    last_contacted_at: string | null;
    created_at: string;
  }[]) {
    if (pastEnquiry.has(contact.id)) continue;
    const lastTouch = contact.last_contacted_at
      ? new Date(contact.last_contacted_at).getTime()
      : null;
    if (lastTouch !== null && lastTouch > cutoff) continue;
    const silentSince = lastTouch ?? new Date(contact.created_at).getTime();
    leads.push({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      name_tag: contact.name_tag,
      daysSilent: Math.max(0, Math.floor((Date.now() - silentSince) / DAY_MS)),
    });
  }

  return leads.sort((a, b) => b.daysSilent - a.daysSilent).slice(0, 20);
}

// --- Today's numbers ---------------------------------------------------

export interface TodayInsights {
  newInquiries: number;
  newContacts: number;
  messagesReceived: number;
  messagesSent: number;
  inboundConversations: number;
  respondedConversations: number;
  showcaseOpens: number;
}

export async function fetchTodayInsights(): Promise<TodayInsights> {
  return withAnalyticsTimeout(
    fetchTodayInsightsUnbounded(),
    'Today analytics'
  );
}

async function fetchTodayInsightsUnbounded(): Promise<TodayInsights> {
  const startIso = startOfLocalDay().toISOString();
  const endIso = endOfLocalDay().toISOString();

  const [convRes, contactRes, msgRes, showcaseRes] = await Promise.all([
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startIso)
      .lte('created_at', endIso),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startIso)
      .lte('created_at', endIso),
    supabase
      .from('messages')
      .select('conversation_id, sender_type')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('conversation_id', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('showcase_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'open')
      .gte('created_at', startIso)
      .lte('created_at', endIso),
  ]);
  if (convRes.error) throw convRes.error;
  if (contactRes.error) throw contactRes.error;
  if (msgRes.error) throw msgRes.error;
  if (showcaseRes.error) throw showcaseRes.error;

  const rows = (msgRes.data ?? []) as {
    conversation_id: string;
    sender_type: string;
  }[];

  let messagesReceived = 0;
  let messagesSent = 0;
  const inbound = new Set<string>();
  const responded = new Set<string>();
  for (const row of rows) {
    if (row.sender_type === 'customer') {
      messagesReceived++;
      inbound.add(row.conversation_id);
    } else {
      messagesSent++;
      if (inbound.has(row.conversation_id)) responded.add(row.conversation_id);
    }
  }

  return {
    newInquiries: convRes.count ?? 0,
    newContacts: contactRes.count ?? 0,
    messagesReceived,
    messagesSent,
    inboundConversations: inbound.size,
    respondedConversations: responded.size,
    showcaseOpens: showcaseRes.count ?? 0,
  };
}
