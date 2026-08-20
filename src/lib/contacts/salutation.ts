export type ContactSalutation = 'Mr.' | 'Mrs.';

function addressParts(
  name: string,
  salutation?: ContactSalutation | null
): { name: string; salutation: ContactSalutation | null } {
  const match = name.match(/^(mr|mrs)\.?\s+(.+)$/i);
  const explicit =
    match?.[1]?.toLowerCase() === 'mrs' ? 'Mrs.' : match ? 'Mr.' : null;
  return {
    name: match?.[2]?.trim() || name,
    salutation: salutation || explicit,
  };
}

export function respectfulContactName(
  name?: string | null,
  salutation?: ContactSalutation | null
): string | null {
  const cleanName = name?.trim();
  if (!cleanName) return null;
  const parts = addressParts(cleanName, salutation);
  return parts.salutation ? `${parts.salutation} ${parts.name}` : parts.name;
}

export function applyContactSalutation(
  text: string | null | undefined,
  name: string | null | undefined,
  salutation: ContactSalutation | null | undefined
): string | null | undefined {
  if (!text || !name?.trim()) return text;
  const parts = addressParts(name.trim(), salutation);
  if (!parts.salutation) return text;
  const cleanName = parts.name;
  const candidates = [cleanName, cleanName.split(/\s+/)[0]];

  for (const candidate of candidates) {
    const addressed = respectfulContactName(candidate, parts.salutation);
    if (!addressed || addressed === candidate) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const greeting = new RegExp(
      `^(Hi|Hello|Hey|Dear|Thanks|Thank you)([ ,]+)${escaped}(?=\\b|[!,.—–-])`,
      'i'
    );
    if (greeting.test(text)) {
      return text.replace(
        greeting,
        (_match, word: string, separator: string) =>
          `${word}${separator}${addressed}`
      );
    }
  }
  return text;
}

export function applySalutationToTemplateParams(
  params: string[] | null | undefined,
  name: string | null | undefined,
  salutation: ContactSalutation | null | undefined
): string[] | null | undefined {
  if (!params || !name?.trim()) return params;
  const parts = addressParts(name.trim(), salutation);
  if (!parts.salutation) return params;
  const cleanName = parts.name;
  const firstName = cleanName.split(/\s+/)[0];

  return params.map((param) => {
    const cleanParam = param.trim();
    if (cleanParam.toLowerCase() === cleanName.toLowerCase()) {
      return respectfulContactName(cleanName, parts.salutation) ?? param;
    }
    if (cleanParam.toLowerCase() === firstName.toLowerCase()) {
      return respectfulContactName(firstName, parts.salutation) ?? param;
    }
    if (/^(mr|mrs)\.?$/i.test(cleanParam)) {
      return respectfulContactName(firstName, parts.salutation) ?? param;
    }
    return param;
  });
}
