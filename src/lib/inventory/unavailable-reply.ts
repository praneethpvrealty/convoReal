import type { SupabaseClient } from '@supabase/supabase-js';
import {
  unavailableListingReply,
  unavailableListingReplyVariants,
} from '@/lib/inventory/listing-status';
import { accountShowcaseBrowseUrl } from '@/lib/showcase/account-showcase-url';
import { hasRequirementOnFile } from '@/lib/whatsapp/unavailable-brief-followup';

/**
 * The unavailable-listing reply with the lead's attributed showcase
 * link on the end, or null when the listing is still available. The
 * link is looked up only when there is a reply to carry it.
 */
export interface UnavailableListingReplyArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  contactName: string | null | undefined;
  propertyTitle: string | null | undefined;
  status: string | null | undefined;
}

/** The reply to send, and every wording a thread may already hold —
 *  the nudge changes once a brief is on file, the once-only check
 *  must not. */
export async function unavailableListingReplyWithShowcaseVariants(
  args: UnavailableListingReplyArgs
): Promise<{ reply: string; variants: string[] } | null> {
  const { contactName, propertyTitle, status } = args;
  if (!unavailableListingReply(contactName, propertyTitle, status)) return null;
  const [showcaseUrl, briefOnFile] = await Promise.all([
    accountShowcaseBrowseUrl(args.db, args.accountId, args.contactId),
    hasRequirementOnFile(args.db, args.accountId, args.contactId),
  ]);
  const reply = unavailableListingReply(
    contactName,
    propertyTitle,
    status,
    showcaseUrl,
    briefOnFile
  );
  if (!reply) return null;
  return {
    reply,
    variants: unavailableListingReplyVariants(
      contactName,
      propertyTitle,
      status,
      showcaseUrl
    ),
  };
}

export async function unavailableListingReplyWithShowcase(
  args: UnavailableListingReplyArgs
): Promise<string | null> {
  return (
    (await unavailableListingReplyWithShowcaseVariants(args))?.reply ?? null
  );
}
