import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property, MatchEventTarget } from '@/types';
import { getMatchingContacts, type MatchDetails } from '@/lib/matching';
import { contactHandle } from '@/lib/contacts/reachability';
import {
  loadContactParties,
  partyDisplayName,
} from '@/lib/contacts/parties';

// Lazy service-role client for callers that only hold an RLS-scoped
// client (match_events has no member INSERT policy — writes are
// engine-only by design).
let _adminClient: SupabaseClient | null = null;
export function radarAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * Match Radar engine (server-only).
 *
 * Computes proactive match events on top of the deterministic matching
 * engine (src/lib/matching.ts) and records them in match_events
 * (migration 094). Called fire-and-forget from:
 *   - POST /api/properties            (form/API creation)
 *   - POST /api/properties/[id]/approve (WhatsApp-lister approval)
 *   - chatbot-engine owner confirm    (WhatsApp intake)
 *   - POST /api/contacts/extract-preferences (buyer prefs changed)
 *
 * Every entry point passes a service-role client, so each query here
 * MUST scope by account_id explicitly — RLS is bypassed.
 *
 * All functions are best-effort and never throw: a radar failure must
 * never break a property save or a webhook. Callers still .catch() as
 * a second layer.
 */

const MIN_SCORE = 60;
const MAX_TARGETS = 12;
export function isRadarContactClassification(
  classification: string | null | undefined
): boolean {
  return ['Buyer', 'Owner & Buyer', 'Agent'].includes(classification || '');
}
/** One event per subject per day — a burst of edits to the same property
 *  shouldn't spam the feed. Refreshing the snapshot of an existing NEW
 *  event is fine; creating a second row is not. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function chipsFromDetails(d: MatchDetails): string[] {
  const chips: string[] = [];
  // A named-project hit forces location to 'match' in the engine, so it
  // stands in for the locality chip rather than sitting next to one the
  // matcher never verified.
  if (d.project === 'match') chips.push('Named project');
  if (d.type === 'match') chips.push('Type match');
  else if (d.type === 'partial') chips.push('Category match');
  if (d.project !== 'match') {
    if (d.location === 'match') chips.push('In area');
    else if (d.location === 'partial') chips.push('Same city');
  }
  if (d.budget === 'match') chips.push('Budget fit');
  else if (d.budget === 'partial') chips.push('Budget near');
  else if (d.budget === 'unknown') chips.push('No budget on file');
  if (d.bhk === 'match') chips.push('BHK fit');
  if (d.roi === 'match') chips.push('Yield ✓');
  return chips;
}

async function upsertEvent(
  db: SupabaseClient,
  accountId: string,
  kind: 'new_property' | 'buyer_updated',
  subject: { property_id?: string; contact_id?: string },
  targets: MatchEventTarget[]
): Promise<void> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  let dupQuery = db
    .from('match_events')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('kind', kind)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (subject.property_id)
    dupQuery = dupQuery.eq('property_id', subject.property_id);
  if (subject.contact_id)
    dupQuery = dupQuery.eq('contact_id', subject.contact_id);

  const { data: existing } = await dupQuery;
  const dup = existing?.[0];

  if (dup && dup.status === 'new') {
    // Refresh the snapshot on the live event instead of stacking a twin.
    await db
      .from('match_events')
      .update({ matches: targets, updated_at: new Date().toISOString() })
      .eq('id', dup.id);
    return;
  }
  if (dup) return; // already sent/dismissed within the window — stay quiet

  const { error } = await db.from('match_events').insert({
    account_id: accountId,
    kind,
    property_id: subject.property_id ?? null,
    contact_id: subject.contact_id ?? null,
    matches: targets,
    status: 'new',
  });
  if (error) console.error('[radar] event insert failed:', error.message);
}

/**
 * New property landed → find matching buyers/agents and record an event.
 */
export async function generateMatchEventForProperty(
  db: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<void> {
  try {
    const [{ data: property }, { data: contacts }, { data: rejected }] = await Promise.all([
      db
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('contacts')
        .select('*, contact_notes(note_text)')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .in('classification', ['Buyer', 'Owner & Buyer', 'Agent']),
      db
        .from('listing_feedback')
        .select('contact_id')
        .eq('account_id', accountId)
        .eq('property_id', propertyId)
        .eq('verdict', 'rejected'),
    ]);

    if (!property || !contacts || contacts.length === 0) return;

    // One target per deal: a husband and wife on one requirement are
    // one buyer to chase, and listing them twice both inflates the
    // event and wastes two of its capped slots.
    const parties = await loadContactParties(db, accountId);
    const rejectedContactIds = new Set(
      ((rejected ?? []) as { contact_id: string }[]).map((row) => row.contact_id)
    );
    const eligibleContacts = (contacts as Contact[]).filter(
      (contact) => !rejectedContactIds.has(contact.id)
    );

    const results = getMatchingContacts(
      property as Property,
      eligibleContacts,
      parties
    )
      .filter((r) => r.score >= MIN_SCORE)
      .slice(0, MAX_TARGETS);

    if (results.length === 0) return;

    const targets: MatchEventTarget[] = results.map((r) => ({
      id: r.contact.id,
      name:
        partyDisplayName(r.party ?? null, [
          r.contact.name ?? '',
          ...(r.alsoMatched ?? []).map((c) => c.name ?? ''),
        ]) ||
        r.contact.name ||
        contactHandle(r.contact),
      detail: contactHandle(r.contact) || null,
      score: r.score,
      chips: chipsFromDetails(r.details),
    }));

    await upsertEvent(
      db,
      accountId,
      'new_property',
      { property_id: propertyId },
      targets
    );
  } catch (err) {
    console.error('[radar] generateMatchEventForProperty failed:', err);
  }
}

export interface RankedPropertyMatch {
  property: Property;
  score: number;
  details: MatchDetails;
}

/**
 * The ranking itself, over rows already in hand. Split out so the dev
 * chatbot simulator can rank against a contact that was never saved.
 */
export function rankProperties(
  contact: Contact,
  properties: Property[]
): RankedPropertyMatch[] {
  const wanted = [
    ...(contact.areas_of_interest || []),
    ...(contact.pref_areas || []),
  ]
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  // Proximity matching resolves a whole neighbourhood to 'match', so
  // listings in the area the contact actually named tie with listings a
  // few kilometres away. Naming the area is the stronger signal — it
  // breaks the tie without changing which listings qualify.
  const inNamedArea = (p: Property): boolean => {
    if (wanted.length === 0) return false;
    const haystack = [p.sublocality, p.location, p.project, ...(p.tags ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return wanted.some((a) => haystack.includes(a));
  };

  const matched: RankedPropertyMatch[] = [];
  const exactEnquiryId =
    contact.requirement_active !== false && !contact.is_dead && !contact.is_archived
      ? contact.last_inquired_property_id
      : null;

  for (const property of properties) {
    if (property.id === exactEnquiryId) {
      matched.push({
        property,
        score: 100,
        details: {
          type: 'unknown',
          location: 'unknown',
          budget: 'unknown',
          bhk: 'unknown',
          roi: 'unknown',
        },
      });
      continue;
    }

    const [result] = getMatchingContacts(property, [contact]);
    if (result && result.score >= MIN_SCORE) {
      matched.push({ property, score: result.score, details: result.details });
    }
  }

  matched.sort((a, b) => {
    const exactOrder =
      Number(b.property.id === exactEnquiryId) -
      Number(a.property.id === exactEnquiryId);
    if (exactOrder !== 0) return exactOrder;
    if (b.score !== a.score) return b.score - a.score;
    return Number(inNamedArea(b.property)) - Number(inNamedArea(a.property));
  });
  return matched;
}

/**
 * Ranks the account's live inventory against one contact's stated
 * preferences, best first. Shared by the Radar event writer below and by
 * the WhatsApp lead-qualification reply (src/lib/ai/buyer-qualification.ts)
 * so both rank the same inventory the same way.
 */
export async function rankPropertiesForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  /** Tightens locality matching from the default 20km radius to 5km for
   *  this ranking only, without touching the contact's own
   *  strict_area_match. Radar suggests to an agent who filters before
   *  sending; a reply sent straight to a buyer who just named their area
   *  cannot afford the loose radius. */
  opts: { strictArea?: boolean } = {}
): Promise<RankedPropertyMatch[]> {
  const [{ data: contact }, { data: properties }, { data: rejected }] =
    await Promise.all([
      db
        .from('contacts')
        .select('*, contact_notes(note_text)')
        .eq('id', contactId)
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('properties')
        .select('*')
        .eq('account_id', accountId)
        .eq('is_published', true)
        .eq('status', 'Available'),
      // The contact said no to these (listing_feedback) — offering them
      // again would spend the trust the feedback prompt just earned.
      db
        .from('listing_feedback')
        .select('property_id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('verdict', 'rejected'),
    ]);

  if (!contact || !properties || properties.length === 0) return [];
  if (!isRadarContactClassification((contact as Contact).classification)) return [];

  const rejectedIds = new Set(
    ((rejected ?? []) as { property_id: string }[]).map((r) => r.property_id)
  );
  const pool = (properties as Property[]).filter((p) => !rejectedIds.has(p.id));

  const subject = opts.strictArea
    ? ({ ...(contact as Contact), strict_area_match: true } as Contact)
    : (contact as Contact);

  return rankProperties(subject, pool);
}

/**
 * Buyer preferences changed → find matching inventory and record an event.
 * Only fires for buyer-side/agent contacts with at least one real match.
 */
export async function generateMatchEventForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    const matched = await rankPropertiesForContact(db, accountId, contactId);
    if (matched.length === 0) return;

    const targets: MatchEventTarget[] = matched
      .slice(0, MAX_TARGETS)
      .map((m) => ({
        id: m.property.id,
        name: m.property.title,
        detail: m.property.property_code || null,
        score: m.score,
        chips: chipsFromDetails(m.details),
      }));

    await upsertEvent(
      db,
      accountId,
      'buyer_updated',
      { contact_id: contactId },
      targets
    );
  } catch (err) {
    console.error('[radar] generateMatchEventForContact failed:', err);
  }
}
