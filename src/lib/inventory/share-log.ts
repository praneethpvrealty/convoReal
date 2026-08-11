/**
 * Property share ledger — records who each property was confirmed
 * shared with on WhatsApp, alongside the journey auto-capture
 * (captureJourneyItems). The ledger is what the agent inventory
 * digest counts: recipient_kind distinguishes end buyers from partner
 * agents, snapshotted at share time so a later reclassification never
 * rewrites reach history.
 *
 * Client-side helper (browser Supabase client, RLS-scoped) called from
 * every surface that confirms a send. Idempotent by construction: the
 * upsert ignores pairs that already exist (UNIQUE(account_id,
 * property_id, contact_id)), so re-sharing never duplicates or bumps
 * created_at.
 *
 * It also captures the journey item, rather than leaving that to the
 * caller. Pairing the two by convention did not hold: the share dialog
 * called both, the property form's broadcast called only this one, and
 * a listing sent from there reached the ledger and never appeared on
 * the contact's journey. One share, one call, both effects — a new
 * share surface cannot forget half of it.
 */

import { createClient } from '@/lib/supabase/client';
import { captureJourneyItems } from '@/lib/journey/capture';
import type { Contact } from '@/types';

export type ShareRecipientKind = 'buyer' | 'agent';

export function shareRecipientKind(
  classification: Contact['classification'] | null | undefined
): ShareRecipientKind {
  return classification === 'Agent' ? 'agent' : 'buyer';
}

export interface RecordPropertySharesInput {
  accountId: string;
  propertyId: string;
  /** auth.users.id of the acting agent, for the created_by audit. */
  userId?: string | null;
  recipients: Array<{
    contactId: string;
    classification?: Contact['classification'] | null;
  }>;
}

export async function recordPropertyShares({
  accountId,
  propertyId,
  userId,
  recipients,
}: RecordPropertySharesInput): Promise<{ created: number; error: string | null }> {
  if (recipients.length === 0) return { created: 0, error: null };
  const supabase = createClient();

  const seen = new Set<string>();
  const payload = recipients
    .filter((r) => {
      if (seen.has(r.contactId)) return false;
      seen.add(r.contactId);
      return true;
    })
    .map((r) => ({
      account_id: accountId,
      property_id: propertyId,
      contact_id: r.contactId,
      recipient_kind: shareRecipientKind(r.classification),
      channel: 'whatsapp',
      created_by: userId ?? null,
    }));

  const { data, error } = await supabase
    .from('property_shares')
    .upsert(payload, {
      onConflict: 'account_id,property_id,contact_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    console.error('Property share log failed:', error.message);
    return { created: 0, error: error.message };
  }

  // Hidden: a share is evidence the agent showed the listing, not yet a
  // decision that it belongs on the map. It lands in the journey's
  // Captured tray for them to place. Failure here must not fail the
  // ledger — the send already happened either way.
  const capture = await captureJourneyItems({
    accountId,
    userId,
    pairs: [...seen].map((contactId) => ({ contactId, propertyId })),
    source: 'whatsapp_share',
    hidden: true,
  });
  if (capture.error) {
    console.error('Journey share capture failed:', capture.error);
  }

  return { created: (data ?? []).length, error: null };
}

/**
 * Who this listing has already gone out to, as contactId → ISO
 * timestamp of the first share. Feeds the "Already shared" marker on
 * the Matching Contacts list so an agent working down it can see at a
 * glance who has already had the communication.
 */
export async function fetchPropertyShareLog(
  accountId: string,
  propertyId: string
): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('property_shares')
    .select('contact_id, created_at')
    .eq('account_id', accountId)
    .eq('property_id', propertyId);

  if (error) {
    console.error('Property share log read failed:', error.message);
    return {};
  }
  return Object.fromEntries(
    (data ?? []).map((row) => [row.contact_id as string, row.created_at as string])
  );
}
