import {
  isOwnerContact,
  findOwnedListings,
  type OwnedListing,
} from '@/lib/owners/owner-reply';
import type { InboundChainContext, StepResult } from '../context';

export async function ownerListings(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, contactRecord } = ctx;
  // A property owner (owner-ish classification, digest targeting, or an
  // actual listing linked to their contact) replying to us must never be
  // greeted by a buyer-intake flow ("let's find your dream property").
  // Suppress flow ENTRY for them — active runs still advance — and
  // answer their free text below with a reply grounded in their own
  // listings instead.
  let ownedListings: OwnedListing[] = [];
  if (isOwnerContact(contactRecord)) {
    ownedListings = await findOwnedListings(accountId, contactRecord.id);
  }
  const isPropertyOwnerSender = ownedListings.length > 0;
  ctx.ownedListings = ownedListings;
  ctx.isPropertyOwnerSender = isPropertyOwnerSender;
  return 'continue';
}
