/**
 * A WhatsApp contact card, forwarded into the assistant.
 *
 * An agent's phonebook name is rarely just a name: "Nadeem Koramangala
 * 8th Block 2100 Sqft Corner Property Owner Nassur" is a person, a
 * property and a second person in one string. Forwarded as a card, that
 * classifies as a listing — correctly, it carries the area, the corner
 * and the locality — and the model then has to guess which of the words
 * is the person. It guessed "Nassur", the token after "Owner", and the
 * name the card itself leads with was lost.
 *
 * The card states the name outright, so it is read from the card here
 * rather than inferred, and split into name + tag by the same
 * deterministic rule the contact intake already uses. Nothing about the
 * property is touched: the model is good at the listing, it was only
 * ever bad at picking a human out of a compound label.
 */

import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split';
import { normalizeClassification, type ParsedPropertyDraft } from '@/lib/ai/gemini';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Header `parseMessageContent` renders a `contacts` message with.
 *  Exported so the renderer and this reader cannot drift apart. */
export const SHARED_CARDS_HEADER = '📥 Shared Contact Cards:';

export interface SharedContactCard {
  name: string;
  phone: string | null;
}

/**
 * Reads the cards back out of the rendered message. Returns [] for any
 * message that is not a shared card, so callers can run it
 * unconditionally.
 */
export function parseSharedContactCards(
  text: string | null | undefined
): SharedContactCard[] {
  const body = (text ?? '').trim();
  if (!body.startsWith(SHARED_CARDS_HEADER)) return [];

  return body
    .slice(SHARED_CARDS_HEADER.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      const name = (match ? match[1] : line).trim();
      const phone = match ? match[2].split(',')[0].trim() : '';
      return { name, phone: phone || null };
    })
    .filter((card) => card.name.length > 0);
}

export interface OwnerFromCard {
  name: string;
  nameTag: string | null;
  phone: string | null;
}

/** The person a forwarded card names, split into the name outbound
 *  messages should greet and the qualifier that belongs on a tag. */
export function ownerFromCard(card: SharedContactCard): OwnerFromCard {
  const split = suggestNameTagSplit(card.name);
  return {
    name: split?.name ?? card.name,
    nameTag: split?.nameTag ?? null,
    phone: card.phone,
  };
}

/**
 * Stamps the card's own person onto a listing parsed from that card.
 *
 * The card wins outright: it is the only place in the message where the
 * name is stated rather than inferred, and the model was reading the
 * same string when it produced its guess. A listing that did not come
 * from a card is returned untouched.
 */
export function applySharedCardOwner(
  draft: ParsedPropertyDraft,
  text: string | null | undefined
): ParsedPropertyDraft {
  const [card] = parseSharedContactCards(text);
  if (!card) return draft;

  const owner = ownerFromCard(card);
  return {
    ...draft,
    owner_contact_name: owner.name,
    owner_contact_name_tag: owner.nameTag,
    owner_contact_phone: owner.phone || draft.owner_contact_phone,
    owner_contact_role: draft.owner_contact_role || 'Owner',
  };
}

/**
 * Files the person on a forwarded card as a contact in their own right,
 * at the moment the card arrives.
 *
 * Somebody who shares a contact card has shared a person, whatever else
 * the card also describes. Waiting for the listing draft to be
 * confirmed meant a cancelled or expired draft took the person with it,
 * and a draft can sit unconfirmed for an hour. Filed as
 * `pending_review`, so it lands in triage rather than straight into the
 * live book.
 *
 * Never renames somebody already on file — an existing record's name is
 * a decision someone made, and a phonebook label should not overwrite
 * it. Best-effort: a failure here must not cost the listing draft.
 */
export async function fileSharedCardContact(input: {
  accountId: string;
  userId: string;
  owner: OwnerFromCard;
  role?: string | null;
}): Promise<{ id: string; name: string; created: boolean } | null> {
  const rawPhone = input.owner.phone?.trim();
  if (!rawPhone) return null;

  const normalized = normalizePhoneWithCountryCode(rawPhone);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, '');

  try {
    const { data: existing } = await supabaseAdmin()
      .from('contacts')
      .select('id, name')
      .eq('account_id', input.accountId)
      .or(
        `phone.eq."${rawPhone.replace(/[\\"]/g, '\\$&')}",phone.eq.${normalized},phone.eq.${digits}`
      );

    if (existing && existing.length > 0) {
      return { id: existing[0].id, name: existing[0].name, created: false };
    }

    const { data: inserted, error } = await supabaseAdmin()
      .from('contacts')
      .insert({
        account_id: input.accountId,
        user_id: input.userId,
        name: input.owner.name,
        name_tag: input.owner.nameTag,
        phone: normalized,
        classification: normalizeClassification(input.role || 'Owner'),
        status: 'pending_review',
        source: 'WhatsApp',
      })
      .select('id, name')
      .single();

    if (error || !inserted) {
      console.error('[shared-cards] contact insert failed:', error);
      return null;
    }
    return { id: inserted.id, name: inserted.name, created: true };
  } catch (err) {
    console.error('[shared-cards] fileSharedCardContact failed:', err);
    return null;
  }
}
