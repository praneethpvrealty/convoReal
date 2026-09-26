import type { SupabaseClient } from '@supabase/supabase-js';

interface IdentifiedSession {
  accountId: string;
  contactId: string;
  sessionKey: string;
}

/**
 * A visitor just revealed who they are (inquiry form, Ask chat): make
 * this browser one of the contact's known devices and pull the session's
 * earlier "Anonymous Guest" events under their name. Only unattributed
 * rows are touched — a session already tied to another contact is never
 * rewritten. Best-effort: identity bookkeeping must never break the
 * response the visitor is waiting on.
 */
export async function attachIdentifiedSession(
  db: SupabaseClient,
  { accountId, contactId, sessionKey }: IdentifiedSession,
  logPrefix: string
): Promise<void> {
  const key = sessionKey.trim().slice(0, 64);
  if (!key) return;

  const [device, stitch] = await Promise.all([
    db
      .from('showcase_visitor_devices')
      .upsert(
        { account_id: accountId, contact_id: contactId, session_key: key },
        { onConflict: 'account_id,session_key', ignoreDuplicates: true }
      ),
    db
      .from('showcase_events')
      .update({ contact_id: contactId })
      .eq('account_id', accountId)
      .eq('session_key', key)
      .is('contact_id', null),
  ]);
  if (device.error) {
    console.error(
      `${logPrefix} Pulse device registration failed (non-fatal):`,
      device.error
    );
  }
  if (stitch.error) {
    console.error(
      `${logPrefix} Pulse session stitch failed (non-fatal):`,
      stitch.error
    );
  }
}
