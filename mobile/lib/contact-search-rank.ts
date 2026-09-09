interface SearchableContact {
  id: string;
  name?: string | null;
  name_tag?: string | null;
  phone?: string | null;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function matchRank(contact: SearchableContact, query: string) {
  const normalizedQuery = normalizeText(query);
  const name = normalizeText(contact.name);
  const nameTag = normalizeText(contact.name_tag);
  const queryDigits = normalizedQuery.replace(/\D/g, '');
  const phoneDigits = (contact.phone ?? '').replace(/\D/g, '');

  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.split(' ').some((part) => part.startsWith(normalizedQuery)))
    return 2;
  if (name.includes(normalizedQuery)) return 3;
  if (nameTag === normalizedQuery) return 4;
  if (nameTag.startsWith(normalizedQuery)) return 5;
  if (nameTag.includes(normalizedQuery)) return 6;
  if (queryDigits && phoneDigits === queryDigits) return 0;
  if (queryDigits && phoneDigits.endsWith(queryDigits)) return 1;
  if (queryDigits && phoneDigits.includes(queryDigits)) return 7;
  return 8;
}

export function rankContactSearchResults<T extends SearchableContact>(
  contacts: T[],
  query: string,
  limit = contacts.length
) {
  const unique = [
    ...new Map(contacts.map((contact) => [contact.id, contact])).values(),
  ];
  return unique
    .map((contact, index) => ({
      contact,
      index,
      rank: matchRank(contact, query),
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        normalizeText(left.contact.name).localeCompare(
          normalizeText(right.contact.name)
        ) ||
        left.index - right.index
    )
    .slice(0, limit)
    .map(({ contact }) => contact);
}
