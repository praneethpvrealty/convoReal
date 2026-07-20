/**
 * Property share ledger — records who each property was confirmed
 * shared with on WhatsApp, alongside the journey auto-capture
 * (captureJourneyItems). The ledger is what the agent inventory
 * digest counts: recipient_kind distinguishes end buyers from partner
 * agents, snapshotted at share time so a later reclassification never
 * rewrites reach history.
 *
 * Client-side helper (browser Supabase client, RLS-scoped) called from
 * the property share dialog after a confirmed send. Idempotent by
 * construction: the upsert ignores pairs that already exist
 * (UNIQUE(account_id, property_id, contact_id)), so re-sharing never
 * duplicates or bumps created_at.
 */

import { createClient } from '@/lib/supabase/client';
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
  return { created: (data ?? []).length, error: null };
}
