// Property type as one tap — the first rung of the alerts onboarding
// ladder, in the same shape as the budget bands: a tap-to-expand list
// whose answer is written to the contact deterministically, no
// extraction. Option values are drawn from the matcher's own type
// vocabulary (TYPE_TO_GROUP in src/lib/matching.ts), so a tapped
// answer gates listings exactly like an agent-entered one.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';

/** Every id this module owns starts with this. */
export const PROPERTY_TYPE_ID_PREFIX = 'pt_';

interface PropertyTypeOption {
  id: string;
  title: string;
  description?: string;
  /** Values written to contacts.pref_property_types — matcher vocabulary. */
  types: string[];
}

const OPTIONS: PropertyTypeOption[] = [
  {
    id: 'pt_plot',
    title: 'Residential Plot',
    types: ['Residential Land/ Plot'],
  },
  { id: 'pt_apartment', title: 'Flat / Apartment', types: ['Flat/ Apartment'] },
  {
    id: 'pt_house',
    title: 'House / Villa',
    types: ['Residential House', 'Villa'],
  },
  {
    id: 'pt_commspace',
    title: 'Commercial Space',
    description: 'Office, shop, showroom or building',
    types: ['Commercial Office Space', 'Commercial Shop'],
  },
  { id: 'pt_commland', title: 'Commercial Land', types: ['Commercial Land'] },
  {
    id: 'pt_agri',
    title: 'Agricultural Land',
    description: 'Farmland',
    types: ['Agricultural Land'],
  },
  {
    id: 'pt_industrial',
    title: 'Industrial',
    types: ['Industrial Land', 'Industrial Building'],
  },
];

const OPTION_BY_ID = new Map(OPTIONS.map((o) => [o.id, o]));

/** The type list. The form row reuses the lfb_form id so the existing
 *  webhook route to the preference form serves this list too. */
export function buildPropertyTypeSections(
  opts: { includeFormRow?: boolean } = {}
): InteractiveListSection[] {
  const rows: { id: string; title: string; description?: string }[] =
    OPTIONS.map(({ id, title, description }) => ({ id, title, description }));
  if (opts.includeFormRow) {
    rows.push({ id: 'lfb_form', title: 'Update preferences' });
  }
  return [{ rows }];
}

/** Sends the type list. Never throws. */
export async function sendPropertyTypePrompt(args: {
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
        'So I only send what fits — what kind of property are you after?',
      interactiveButtonLabel: 'Pick a type',
      interactiveSections: buildPropertyTypeSections({
        includeFormRow: args.includeFormRow,
      }),
      customDbClient: args.db,
    });
    return result.success;
  } catch (err) {
    console.error('[property-type] prompt send failed:', err);
    return false;
  }
}

/**
 * Applies a tapped type to the contact. Returns true when the tap was
 * consumed — the caller continues the onboarding ladder (budget, then
 * matches), which is the tap's real acknowledgement.
 */
export async function handlePropertyTypeReply(args: {
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
      .update({ pref_property_types: option.types })
      .eq('id', args.contactId)
      .eq('account_id', args.accountId);
    return true;
  } catch (err) {
    console.error('[property-type] contact update failed:', err);
    // The tap was ours; falling through would hand a type id to
    // handlers that cannot make sense of it.
    return true;
  }
}
