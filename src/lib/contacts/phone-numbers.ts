// A contact keeps one primary `phone` and any number of `secondary_phones`.
// Every WhatsApp path — the personal wa.me link, the Engine inbox thread,
// templates, digests — addresses the primary, so a contact whose WhatsApp
// lives on another number has to be able to promote it. Web and mobile
// share these two rules so the swap and the number list behave alike.

export interface ContactPhones {
  phone?: string | null;
  secondary_phones?: string[] | null;
  whatsapp_phone_confirmed_at?: string | null;
}

export interface PromotedPhones {
  phone: string;
  secondary_phones: string[];
}

/** Primary first, then the other numbers, trimmed and de-duplicated. */
export function contactPhoneNumbers(contact: ContactPhones): string[] {
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const raw of [contact.phone, ...(contact.secondary_phones ?? [])]) {
    const phone = raw?.trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    numbers.push(phone);
  }
  return numbers;
}

/** Make `candidate` the primary number. The previous primary takes the
 *  slot the candidate held among the other numbers, so nothing is lost
 *  and the list keeps its order. */
export function promotePhone(
  contact: ContactPhones,
  candidate: string
): PromotedPhones {
  const next = candidate.trim();
  const previous = contact.phone?.trim() ?? '';
  const secondary = (contact.secondary_phones ?? [])
    .map((phone) => phone.trim())
    .filter(Boolean);
  const slot = secondary.indexOf(next);
  const rest = secondary.filter((phone) => phone !== next);
  if (previous && previous !== next) {
    rest.splice(
      slot === -1 ? rest.length : Math.min(slot, rest.length),
      0,
      previous
    );
  }
  return { phone: next, secondary_phones: Array.from(new Set(rest)) };
}

/** The WhatsApp action asks which number to use only while the contact
 *  has more than one and no one has answered yet. */
export function needsWhatsAppPhoneChoice(contact: ContactPhones): boolean {
  return (
    !contact.whatsapp_phone_confirmed_at &&
    contactPhoneNumbers(contact).length > 1
  );
}

export interface ChosenWhatsAppPhone extends PromotedPhones {
  whatsapp_phone_confirmed_at: string;
}

/** Record the answer: the chosen number becomes the primary — the number
 *  every WhatsApp path addresses — and the choice is stamped so the
 *  question is not asked again. */
export function chooseWhatsAppPhone(
  contact: ContactPhones,
  phone: string,
  now: string = new Date().toISOString()
): ChosenWhatsAppPhone {
  return { ...promotePhone(contact, phone), whatsapp_phone_confirmed_at: now };
}
