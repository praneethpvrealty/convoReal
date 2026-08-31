/**
 * The funnel's "Yes, keep me posted" tap, recorded where the rest of
 * the product looks for it.
 *
 * The showcase funnel has always answered that tap with "You're on the
 * list — the engine now watches every new listing against it", and
 * nothing behind it was true: the daily buyer match digest
 * (src/lib/buyer/digest-sender.ts) reads
 * `contacts.buyer_alerts_consent`, and the funnel never wrote it. The
 * lead sat at 'pending' and the digest skipped them.
 *
 * So this is the missing write, not a second alerting engine. Consent
 * is the whole point: the alert goes out as a MARKETING template when
 * the lead's window is shut, and an explicit in-chat opt-in is what
 * makes that legitimate.
 *
 * `requested_at` is stamped alongside so the digest's own consent-ask
 * never re-asks somebody who has already said yes.
 *
 * Never throws — a bookkeeping failure must not break the funnel reply
 * the lead is waiting on.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

/**
 * A lead who taps "keep me posted" is telling us they buy. Their
 * classification decides whether the digest considers them at all, so
 * an unclassified lead is promoted — but a stated role is never
 * overwritten, and an owner becomes both rather than stops being an
 * owner.
 *
 */
export function classificationAfterSubscribe(
  current: Contact['classification'] | null | undefined
): Contact['classification'] | null {
  if (!current || current === 'Others') return 'Buyer';
  if (current === 'Owner' || current === 'Seller') return 'Owner & Buyer';
  return null;
}

export async function grantAlertsConsent(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('classification, buyer_alerts_consent')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact) return false;

    const promoted = classificationAfterSubscribe(
      contact.classification as Contact['classification'] | null
    );
    const { error } = await db
      .from('contacts')
      .update({
        buyer_alerts_consent: 'granted',
        buyer_alerts_consent_requested_at: new Date().toISOString(),
        ...(promoted ? { classification: promoted } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('account_id', accountId);
    if (error) {
      console.error('[flows] alerts consent write failed:', error.message);
      return false;
    }

    // The record of what they agreed to, where an agent reviewing the
    // contact will see it.
    await db.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      note_text:
        'Opted in to new-listing alerts on WhatsApp — tapped "keep me posted" in the chat funnel.',
    });
    return true;
  } catch (err) {
    console.error('[flows] alerts consent threw:', err);
    return false;
  }
}
