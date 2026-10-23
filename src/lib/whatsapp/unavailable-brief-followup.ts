import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildRequirementSummary,
  sendRequirementReview,
} from '@/lib/whatsapp/requirement-review';
import { nextQualifierForContact } from '@/lib/ai/buyer-qualification';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import type { Contact } from '@/types';

export const REGRET_BRIEF_CLOSING =
  "Tap *All correct* and I'll send you the closest live options right away, or tweak anything that has changed.";

export function buildRegretBriefOpening(
  contactName: string | null | undefined
): string {
  const first = isPlaceholderLeadName(contactName)
    ? null
    : contactName!.trim().split(/\s+/)[0];
  return `Here's the requirement I have on file for you${first ? `, ${first}` : ''}:`;
}

export async function loadRequirementOnFile(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<Contact | null> {
  const { data } = await db
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  const contact = (data ?? null) as Contact | null;
  return contact &&
    buildRequirementSummary(contact) &&
    nextQualifierForContact(contact, { defaultBuying: true }) === null
    ? contact
    : null;
}

export async function hasRequirementOnFile(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  return (await loadRequirementOnFile(db, accountId, contactId)) !== null;
}

export async function sendRequirementConfirmAfterRegret(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string | null | undefined;
}): Promise<boolean> {
  const { db, accountId, userId, contactId, conversationId } = args;
  const contact = await loadRequirementOnFile(db, accountId, contactId);
  if (!contact) return false;
  return sendRequirementReview({
    db,
    accountId,
    userId,
    contactId,
    conversationId,
    contact,
    opening: buildRegretBriefOpening(contact.name),
    closing: REGRET_BRIEF_CLOSING,
  });
}
