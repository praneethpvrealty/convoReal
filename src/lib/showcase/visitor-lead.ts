// ============================================================
// Shared lead capture for anonymous showcase visitors who reveal a
// phone number — the Ask-this-property chat and the catalog lead bot
// both land here. Attribution, the audit note, and the Pulse session
// stitch are identical for both, and every step is best-effort: a
// bookkeeping failure must never break the answer the visitor is
// waiting on.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';

export interface VisitorLeadInput {
  accountId: string;
  /** Managing agent for the listing; falls back to the account owner. */
  userId?: string | null;
  phone: string;
  name?: string | null;
  classification?: string;
  /** Write-once attribution on create, e.g. 'Showcase Q&A'. */
  referrer: string;
  /** Appended as a contact note, so repeat visits accumulate. */
  note: string;
  /** Pulse session to retro-attribute to this contact. */
  sessionKey?: string;
  propertyId?: string | null;
  areasOfInterest?: string[];
  propertyInterests?: string[];
  maxBudget?: number | null;
}

/**
 * Captures the visitor as a contact and returns its id, or null when the
 * account can't be resolved. Never throws.
 *
 * `source` is deliberately not set — find-or-create overwrites it on
 * every call, which would clobber an existing contact's original
 * attribution (e.g. a prior "Website Showcase" inquiry) each time they
 * come back. `referrer` is write-once on create.
 */
export async function captureVisitorLead(
  db: SupabaseClient,
  input: VisitorLeadInput
): Promise<string | null> {
  try {
    let userId = input.userId ?? null;
    if (!userId) {
      const { data: account } = await db
        .from('accounts')
        .select('owner_user_id')
        .eq('id', input.accountId)
        .maybeSingle();
      userId = (account?.owner_user_id as string | undefined) ?? null;
    }
    if (!userId) return null;

    const { contactId } = await findOrCreateContact(db, {
      accountId: input.accountId,
      userId,
      phone: input.phone,
      name: input.name?.trim() || 'Showcase Visitor',
      classification: input.classification || 'Buyer',
      referrer: input.referrer,
      lastInquiredPropertyId: input.propertyId ?? null,
      areasOfInterest: input.areasOfInterest,
      propertyInterests: input.propertyInterests,
      maxBudget: input.maxBudget ?? null,
    });

    await db.from('contact_notes').insert({
      account_id: input.accountId,
      contact_id: contactId,
      user_id: userId,
      note_text: input.note,
    });

    // The visitor just revealed who they are, so their earlier
    // "Anonymous Guest" Pulse events from this browser session can show
    // up under their name too. Only unattributed rows are touched — a
    // session already tied to another contact is never rewritten.
    if (input.sessionKey) {
      const { error: stitchError } = await db
        .from('showcase_events')
        .update({ contact_id: contactId })
        .eq('account_id', input.accountId)
        .eq('session_key', input.sessionKey)
        .is('contact_id', null);
      if (stitchError) {
        console.error(
          '[captureVisitorLead] Pulse session stitch failed (non-fatal):',
          stitchError
        );
      }
    }

    return contactId;
  } catch (err) {
    console.error('[captureVisitorLead] failed (non-fatal):', err);
    return null;
  }
}
