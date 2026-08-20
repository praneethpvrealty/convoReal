// Buy or rent as one tap — the rung that decides which half of the
// inventory a lead is shown, in the same shape as the property-type
// list and the budget bands: the answer is written to the contact
// deterministically, no extraction. Values are the matcher's own
// listing-type vocabulary, so a tapped answer gates listings exactly
// like an agent-entered one.
//
// It sits ahead of the budget rung on purpose. The band list already
// asks a rent-only lead for a monthly figure and everyone else for a
// sale figure (src/lib/whatsapp/budget-band.ts), but nothing ever
// asked, so a tenant was offered ₹50L–₹5Cr+ bands and answered the
// wrong question.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';

/** Every id this module owns starts with this. */
export const LISTING_INTENT_ID_PREFIX = 'li_';

interface ListingIntentOption {
  id: string;
  title: string;
  description?: string;
  /** Values written to contacts.pref_listing_types — matcher vocabulary. */
  types: string[];
  /** How the acknowledgement names the choice. */
  label: string;
}

// 'Either' is a real answer, not a non-answer: it records that both
// halves of the inventory are wanted, which is what an empty column
// means to the matcher anyway — but it stops the ladder asking again.
const OPTIONS: ListingIntentOption[] = [
  {
    id: 'li_sale',
    title: 'Buying',
    description: 'Looking to purchase',
    types: ['Sale'],
    label: 'buying',
  },
  {
    id: 'li_rent',
    title: 'Renting',
    description: 'Looking to lease',
    types: ['Rent'],
    label: 'renting',
  },
  {
    id: 'li_both',
    title: 'Either',
    description: 'Show me both',
    types: ['Sale', 'Rent'],
    label: 'both',
  },
];

const OPTION_BY_ID = new Map(OPTIONS.map((o) => [o.id, o]));

export function listingIntentAcknowledgement(replyId: string): string | null {
  const option = OPTION_BY_ID.get(replyId);
  if (!option) return null;
  return `Got it — ${option.label}. I'll keep the rest of your search unchanged.`;
}

/** The intent list. The form row reuses the lfb_form id so the existing
 *  webhook route to the preference form serves this list too. */
export function buildListingIntentSections(
  opts: { includeFormRow?: boolean } = {}
): InteractiveListSection[] {
  const rows: { id: string; title: string; description?: string }[] =
    OPTIONS.map(({ id, title, description }) => ({ id, title, description }));
  if (opts.includeFormRow) {
    rows.push({ id: 'lfb_form', title: 'Update preferences' });
  }
  return [{ rows }];
}

/** Sends the intent list. Never throws. */
export async function sendListingIntentPrompt(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  bodyText?: string;
  includeFormRow?: boolean;
}): Promise<boolean> {
  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody:
        args.bodyText ??
        "Quick one so I send the right half of our list — are you looking to buy or to rent?",
      interactiveButtonLabel: 'Buy or rent',
      interactiveSections: buildListingIntentSections({
        includeFormRow: args.includeFormRow,
      }),
      customDbClient: args.db,
    });
    return result.success;
  } catch (err) {
    console.error('[listing-intent] prompt send failed:', err);
    return false;
  }
}

/**
 * Applies a tapped intent to the contact. Returns true when the tap was
 * consumed — the caller continues the onboarding ladder, which is the
 * tap's real acknowledgement.
 */
export async function handleListingIntentReply(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  replyId: string;
}): Promise<boolean> {
  const option = OPTION_BY_ID.get(args.replyId);
  if (!option) return false;

  try {
    await args.db
      .from('contacts')
      .update({ pref_listing_types: option.types })
      .eq('id', args.contactId)
      .eq('account_id', args.accountId);
    return true;
  } catch (err) {
    console.error('[listing-intent] contact update failed:', err);
    // The tap was ours; falling through would hand an intent id to
    // handlers that cannot make sense of it.
    return true;
  }
}
