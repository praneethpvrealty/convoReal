import type { SupabaseClient } from '@supabase/supabase-js';
import { unavailableListingReply } from '@/lib/inventory/listing-status';
import { accountShowcaseBrowseUrl } from '@/lib/showcase/account-showcase-url';
import { hasRequirementOnFile } from '@/lib/whatsapp/unavailable-brief-followup';

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
  const [showcaseUrl, briefOnFile] = await Promise.all([
    accountShowcaseBrowseUrl(args.db, args.accountId, args.contactId),
    hasRequirementOnFile(args.db, args.accountId, args.contactId),
  ]);
  return unavailableListingReply(
    contactName,
    propertyTitle,
    status,
    showcaseUrl,
    briefOnFile
  );
}
