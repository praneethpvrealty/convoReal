/**
 * Property share ledger — records who each property was confirmed
 * shared with, and over which channel, alongside the journey
 * auto-capture. The ledger is what the agent inventory digest counts:
 * recipient_kind distinguishes end buyers from partner agents,
 * snapshotted at share time so a later reclassification never rewrites
 * reach history.
 *
 * Called from every surface that confirms a send. Both effects happen
 * server-side in one request (POST /api/properties/share-log →
 * logPropertyShare), so a share surface cannot forget half of it and a
 * tab closing mid-way cannot lose the second half: the browser used to
 * write the ledger and the journey as two separate requests, and for
 * six weeks nearly every share reached the ledger and never the journey.
 * Idempotent by construction: re-sharing never duplicates or bumps
 * created_at. The route answers 200 with the recipients it could not
 * write; those are retried, and a share still missing afterwards comes
 * back as an error rather than a quiet short count.
 */

import { createClient } from '@/lib/supabase/client';
import {
  postShareLog,
  type ShareLogResponse,
} from '@/lib/inventory/share-log-request';
import type { Contact } from '@/types';

export type ShareRecipientKind = 'buyer' | 'agent';

export function shareRecipientKind(
  classification: Contact['classification'] | null | undefined
): ShareRecipientKind {
  return classification === 'Agent' ? 'agent' : 'buyer';
}

export type ShareChannel = 'whatsapp' | 'email';

export interface RecordPropertySharesInput {
  accountId: string;
  propertyId: string;
  /** auth.users.id of the acting agent, for the created_by audit. */
  userId?: string | null;
  recipients: Array<{
    contactId: string;
    classification?: Contact['classification'] | null;
  }>;
  /**
   * How the listing went out. WhatsApp sends are confirmed by the API
   * that performed them; an email send is confirmed by the agent,
   * because the mail leaves from their own client and the app never
   * sees it. Defaults to whatsapp — the channel every caller predating
   * the email composer used.
   */
  channel?: ShareChannel;
  /** Show a deliberate one-to-one share on the journey map immediately. */
  journeyVisible?: boolean;
}

export async function recordPropertyShares({
  propertyId,
  recipients,
  channel = 'whatsapp',
  journeyVisible = false,
}: RecordPropertySharesInput): Promise<{
  created: number;
  error: string | null;
}> {
  if (recipients.length === 0) return { created: 0, error: null };
  const outcome = await postShareLog(
    async (body) => {
      const res = await fetch('/api/properties/share-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const payload = (await res.json().catch(() => null)) as
        (ShareLogResponse & { error?: string }) | null;
      if (!res.ok) {
        throw Object.assign(
          new Error(payload?.error || `Share log failed (${res.status})`),
          { status: res.status }
        );
      }
      return payload;
    },
    {
      property_id: propertyId,
      recipients: recipients.map((r) => ({
        contact_id: r.contactId,
        classification: r.classification ?? null,
      })),
      channel,
      journey_visible: journeyVisible,
    }
  );
  if (outcome.error) console.error('Property share log failed:', outcome.error);
  return { created: outcome.recorded, error: outcome.error };
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
    (data ?? []).map((row) => [
      row.contact_id as string,
      row.created_at as string,
    ])
  );
}
