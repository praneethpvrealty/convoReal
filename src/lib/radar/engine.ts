import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property, MatchEventTarget } from '@/types';
import { getMatchingContacts, type MatchDetails } from '@/lib/matching';

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
/** One event per subject per day — a burst of edits to the same property
 *  shouldn't spam the feed. Refreshing the snapshot of an existing NEW
 *  event is fine; creating a second row is not. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function chipsFromDetails(d: MatchDetails): string[] {
  const chips: string[] = [];
  if (d.type === 'match') chips.push('Type match');
  else if (d.type === 'partial') chips.push('Category match');
  if (d.location === 'match') chips.push('In area');
  else if (d.location === 'partial') chips.push('Same city');
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
  if (subject.property_id) dupQuery = dupQuery.eq('property_id', subject.property_id);
  if (subject.contact_id) dupQuery = dupQuery.eq('contact_id', subject.contact_id);

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
    const [{ data: property }, { data: contacts }] = await Promise.all([
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
        .in('classification', ['Buyer', 'Agent']),
    ]);

    if (!property || !contacts || contacts.length === 0) return;

    const results = getMatchingContacts(property as Property, contacts as Contact[])
      .filter((r) => r.score >= MIN_SCORE)
      .slice(0, MAX_TARGETS);

    if (results.length === 0) return;

    const targets: MatchEventTarget[] = results.map((r) => ({
      id: r.contact.id,
      name: r.contact.name || r.contact.phone,
      detail: r.contact.phone,
      score: r.score,
      chips: chipsFromDetails(r.details),
    }));

    await upsertEvent(db, accountId, 'new_property', { property_id: propertyId }, targets);
  } catch (err) {
    console.error('[radar] generateMatchEventForProperty failed:', err);
  }
}

/**
 * Buyer preferences changed → find matching inventory and record an event.
 * Only fires for Buyer/Agent contacts with at least one real match.
 */
export async function generateMatchEventForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    const [{ data: contact }, { data: properties }] = await Promise.all([
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
    ]);

    if (!contact || !properties || properties.length === 0) return;
    if (!['Buyer', 'Agent'].includes((contact as Contact).classification || '')) return;

    const matched: { property: Property; score: number; details: MatchDetails }[] = [];
    for (const property of properties as Property[]) {
      const [result] = getMatchingContacts(property, [contact as Contact]);
      if (result && result.score >= MIN_SCORE) {
        matched.push({ property, score: result.score, details: result.details });
      }
    }
    if (matched.length === 0) return;

    matched.sort((a, b) => b.score - a.score);
    const targets: MatchEventTarget[] = matched.slice(0, MAX_TARGETS).map((m) => ({
      id: m.property.id,
      name: m.property.title,
      detail: m.property.property_code || null,
      score: m.score,
      chips: chipsFromDetails(m.details),
    }));

    await upsertEvent(db, accountId, 'buyer_updated', { contact_id: contactId }, targets);
  } catch (err) {
    console.error('[radar] generateMatchEventForContact failed:', err);
  }
}
