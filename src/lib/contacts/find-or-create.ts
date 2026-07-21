/**
 * Shared contact find-or-create with phone + email deduplication.
 *
 * Used by:
 *   • /api/leads/email-webhook  (portal lead ingestion)
 *   • /api/public/inquiry       (showcase website inquiries)
 *
 * Dedup order:
 *   1. Normalised phone match (digits-only, within account)
 *   2. Email match (lower-cased, within account)
 *   3. No match → create new contact
 *
 * Merged contacts (is_merged = true) are excluded from the lookup so a
 * merge winner always surfaces and a merge loser never absorbs new leads.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ContactInput {
  accountId: string;
  userId: string;           // agent/owner to own this contact
  phone: string;            // raw phone from lead source
  name?: string | null;
  email?: string | null;
  company?: string | null;
  source?: string | null;
  classification?: string;
  referrer?: string | null;
  referrerContactId?: string | null;
  lastInquiredPropertyId?: string | null;
  maxBudget?: number | null;
  areasOfInterest?: string[];
  propertyInterests?: string[];
}

export interface FindOrCreateResult {
  contactId: string;
  isNew: boolean;
  matchedOn: 'phone' | 'email' | 'created';
}

/** Normalise a phone to digits-only (strip +, spaces, dashes, parens). */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Normalise email to lowercase and trim. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findOrCreateContact(
  supabase: SupabaseClient,
  input: ContactInput,
): Promise<FindOrCreateResult> {
  const normPhone = normalisePhone(input.phone);
  const normEmail = input.email ? normaliseEmail(input.email) : null;

  // ── 1. Phone lookup ────────────────────────────────────────────────────────
  // Match raw phone OR digits-only phone (handles +91-9876543210 vs 9876543210).
  const { data: byPhone } = await supabase
    .from('contacts')
    .select('id')
    .eq('account_id', input.accountId)
    .eq('is_merged', false)
    .or(`phone.eq."${String(input.phone).replace(/[\\"]/g, '\\$&')}",phone.eq.${normPhone}`)
    .limit(1)
    .maybeSingle();

  if (byPhone) {
    await applyUpdates(supabase, byPhone.id, input);
    return { contactId: byPhone.id, isNew: false, matchedOn: 'phone' };
  }

  // ── 2. Email lookup ────────────────────────────────────────────────────────
  if (normEmail) {
    const { data: byEmail } = await supabase
      .from('contacts')
      .select('id')
      .eq('account_id', input.accountId)
      .eq('is_merged', false)
      .eq('email', normEmail)
      .limit(1)
      .maybeSingle();

    if (byEmail) {
      await applyUpdates(supabase, byEmail.id, input);
      return { contactId: byEmail.id, isNew: false, matchedOn: 'email' };
    }
  }

  // ── 3. Create new contact ──────────────────────────────────────────────────
  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      phone: input.phone,
      name: (input.name || 'Unknown Lead').trim(),
      email: normEmail,
      company: input.company ?? null,
      source: input.source ?? null,
      classification: input.classification ?? 'Buyer',
      referrer: input.referrer ?? null,
      referrer_contact_id: input.referrerContactId ?? null,
      last_inquired_property_id: input.lastInquiredPropertyId ?? null,
      max_budget: input.maxBudget ?? null,
      areas_of_interest: input.areasOfInterest ?? [],
      property_interests: input.propertyInterests ?? [],
      status: 'pending_review',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Contact creation failed: ${error.message}`);
  return { contactId: created.id, isNew: true, matchedOn: 'created' };
}

/** Apply non-destructive updates to an existing contact on re-ingestion. */
async function applyUpdates(
  supabase: SupabaseClient,
  contactId: string,
  input: ContactInput,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'pending_review',
    updated_at: new Date().toISOString(),
  };

  // Only fill-in gaps — never overwrite existing data with blanks
  if (input.name) patch.name_fallback = input.name; // handled below
  if (input.email) patch.email = normaliseEmail(input.email);
  if (input.company) patch.company = input.company;
  if (input.source) patch.source = input.source;
  if (input.referrerContactId) patch.referrer_contact_id = input.referrerContactId;
  if (input.lastInquiredPropertyId) patch.last_inquired_property_id = input.lastInquiredPropertyId;
  if (input.maxBudget) patch.max_budget = input.maxBudget;
  if (input.areasOfInterest?.length) patch.areas_of_interest = input.areasOfInterest;
  if (input.propertyInterests?.length) patch.property_interests = input.propertyInterests;

  // Don't overwrite a real name with "Unknown Lead"
  delete patch.name_fallback;

  // Fetch current name to decide if we should update it
  const { data: current } = await supabase
    .from('contacts')
    .select('name, email')
    .eq('id', contactId)
    .single();

  if (current && !current.name && input.name) {
    patch.name = input.name.trim();
  }
  if (current && !current.email && input.email) {
    patch.email = normaliseEmail(input.email);
  }

  await supabase.from('contacts').update(patch).eq('id', contactId);
}
