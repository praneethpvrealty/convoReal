import {
  isOwnerContact,
  findOwnedListings,
  lastOwnerTemplateAt,
  speaksAsBuyer,
  type OwnedListing,
} from '@/lib/owners/owner-reply';
import { loadSubjectThread } from '@/lib/learning/subject';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function ownerListings(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, contactRecord, conversation, message } = ctx;
  // A property owner (owner-ish classification, digest targeting, or an
  // actual listing linked to their contact) replying to us must never be
  // greeted by a buyer-intake flow ("let's find your dream property").
  // Suppress flow ENTRY for them — active runs still advance — and
  // answer their free text below with a reply grounded in their own
  // listings instead. Unless the thread is about a listing they do not
  // own: then they are a buyer asking about it, and the buyer Q&A
  // answers them.
  let ownedListings: OwnedListing[] = [];
  if (isOwnerContact(contactRecord)) {
    ownedListings = await findOwnedListings(accountId, contactRecord.id);
  }
  let isPropertyOwnerSender = ownedListings.length > 0;
  if (isPropertyOwnerSender) {
    const [thread, ownerAddressedAt] = await Promise.all([
      loadSubjectThread(
        supabaseAdmin(),
        accountId,
        contactRecord.id,
        conversation.id,
        { messageId: message.id, quotedMessageId: message.context?.id ?? null }
      ),
      lastOwnerTemplateAt(conversation.id),
    ]);
    if (
      thread &&
      speaksAsBuyer(
        thread,
        ownedListings.map((listing) => listing.id),
        Date.now(),
        ownerAddressedAt
      )
    ) {
      isPropertyOwnerSender = false;
    }
  }
  ctx.ownedListings = ownedListings;
  ctx.isPropertyOwnerSender = isPropertyOwnerSender;
  return 'continue';
}
