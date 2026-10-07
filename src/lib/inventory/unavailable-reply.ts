import type { SupabaseClient } from '@supabase/supabase-js';
import { unavailableListingReply } from '@/lib/inventory/listing-status';
import { accountShowcaseBrowseUrl } from '@/lib/showcase/account-showcase-url';

/**
 * The unavailable-listing reply with the lead's attributed showcase
 * link on the end, or null when the listing is still available. The
 * link is looked up only when there is a reply to carry it.
 */
export async function unavailableListingReplyWithShowcase(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  contactName: string | null | undefined;
  propertyTitle: string | null | undefined;
  status: string | null | undefined;
}): Promise<string | null> {
  const { contactName, propertyTitle, status } = args;
  if (!unavailableListingReply(contactName, propertyTitle, status)) return null;
  return unavailableListingReply(
    contactName,
    propertyTitle,
    status,
    await accountShowcaseBrowseUrl(args.db, args.accountId, args.contactId)
  );
}
