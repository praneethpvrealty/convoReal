// Mirrors the web module src/lib/contacts/phone-numbers.ts 1:1 — both
// rules are compared text-for-text by src/lib/mobile-parity.test.ts.
// Edit the web file first, then copy.

export interface ContactPhones {
  phone?: string | null;
  secondary_phones?: string[] | null;
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
