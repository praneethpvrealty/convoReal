import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dead and archived contacts — the states that keep a contact list
 * worth reading.
 *
 * "Close my enquiry" used to write nothing but
 * `buyer_alerts_consent = 'declined'`, which excludes a contact from
 * broadcast audiences and nothing else: automations, digests, Match
 * Radar, property shares and the matching engine all carried on. A lead
 * who has said they are done is not an alerts preference, so closing an
 * enquiry now marks the contact dead (migration 230) and that state is
 * enforced where sends and matches actually happen.
 *
 * Dead is not a silent delete. Agents still see the contact and can
 * still reply by hand if the lead calls back — the inbox composer warns
 * them first. Only automated sending is refused.
 */

export type DeadReason =
  | 'closed_enquiry'
  | 'stop_alerts'
  | 'manual'
  | 'bulk_cleanup';

/** Thrown by the dispatcher when an automated send targets a dead contact. */
export const DEAD_CONTACT_BLOCKED_MESSAGE =
  'This lead closed their enquiry — automated messages are blocked. Reply from the inbox if you need to reach them.';

/** What an agent sees above the composer on a dead contact's thread. */
export const DEAD_CONTACT_NOTICE =
  'This lead closed their enquiry. They are excluded from campaigns, digests and matching. Anything you send here goes out as a personal reply.';

export interface MarkContactDeadArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  reason: DeadReason;
  /** Written to contact_notes as the audit trail. Falls back to the reason. */
  note?: string;
  /** Author of the note; omitted for lead-initiated closes. */
  userId?: string | null;
}

/**
 * Mark one contact dead and take the three consequences with it: the
 * requirement stops matching, alerts stop, and a note records why.
 *
 * `requirement_active` is what `src/lib/matching.ts` already reads to
 * park a brief, so closing an enquiry reuses it rather than teaching
 * the matcher a second way to say the same thing.
 */
export async function markContactDead(
  args: MarkContactDeadArgs
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await args.db
    .from('contacts')
    .update({
      is_dead: true,
      dead_at: now,
      dead_reason: args.reason,
      requirement_active: false,
      buyer_alerts_consent: 'declined',
      updated_at: now,
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);

  if (error) {
    console.error('[contact-lifecycle] mark dead failed:', error.message);
    return false;
  }

  await args.db.from('contact_notes').insert({
    contact_id: args.contactId,
    account_id: args.accountId,
    user_id: args.userId ?? null,
    note_text: args.note ?? `Lead marked dead (${args.reason})`,
  });

  return true;
}

/**
 * Undo it. Alerts stay declined — the lead opted out of those in their
 * own words, and reviving a record is the agent's decision to make, not
 * consent to message them again.
 */
export async function reviveContact(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
}): Promise<boolean> {
  const { error } = await args.db
    .from('contacts')
    .update({
      is_dead: false,
      dead_at: null,
      dead_reason: null,
      requirement_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId);

  if (error) {
    console.error('[contact-lifecycle] revive failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Whether a contact is excluded from automated sending, matching and
 * audiences. One predicate so every caller agrees on what "live" means.
 */
export function isContactReachable(contact: {
  is_dead?: boolean | null;
  is_archived?: boolean | null;
}): boolean {
  return !contact.is_dead && !contact.is_archived;
}
