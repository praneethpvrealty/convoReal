import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOwnerWhatsAppContact } from '@/lib/inventory/location-requests';

/**
 * The human a voice call can name and hand off to.
 *
 * A qualification call that ends "someone will get back to you" wastes
 * the goodwill it just earned; naming the agent and offering their
 * number is the difference between a lead that waits and a lead that
 * calls back. The contact's assigned agent is that person, falling
 * back to whoever launched the campaign — never nobody, because the
 * agent prompt reads these as plain strings.
 *
 * The phone is the WhatsApp-reachable one the brokerage actually uses
 * (resolveOwnerWhatsAppContact), not whatever sits on the profile row,
 * so a lead who calls it back reaches the same thread the follow-up
 * will arrive in.
 */

export interface AssignedAgent {
  name: string;
  phone: string;
}

export async function resolveAssignedAgent(
  admin: SupabaseClient,
  accountId: string,
  userId: string | null
): Promise<AssignedAgent | null> {
  if (!userId) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('user_id', userId)
    .maybeSingle();

  const whatsapp = await resolveOwnerWhatsAppContact(admin, accountId, userId);
  const name = (profile?.full_name as string | undefined)?.trim();
  if (!name && !whatsapp?.phone) return null;

  return { name: name || '', phone: whatsapp?.phone || '' };
}

/** Per-run memo: one dispatcher tick dials for a handful of contacts,
 *  who often share an agent. */
export function assignedAgentCache(
  admin: SupabaseClient,
  accountId: string
): (userId: string | null) => Promise<AssignedAgent | null> {
  const seen = new Map<string, AssignedAgent | null>();
  return async (userId) => {
    if (!userId) return null;
    if (!seen.has(userId)) {
      seen.set(userId, await resolveAssignedAgent(admin, accountId, userId));
    }
    return seen.get(userId) ?? null;
  };
}
