export const PUBLIC_PROFILE_DESCRIPTION_MAX = 600;
export const PUBLIC_PROFILE_LIST_MAX = 12;
export const PUBLIC_PROFILE_ITEM_MAX = 80;

export type PublicProfilePatch = {
  description?: string | null;
  areasServed?: string[] | null;
  propertyExpertise?: string[] | null;
};

type ParseResult =
  | { ok: true; value: PublicProfilePatch }
  | { ok: false; error: string };

function parseList(value: unknown, label: string): string[] | null | string {
  if (value === null) return null;
  if (!Array.isArray(value)) return `${label} must be an array`;
  if (value.some((item) => typeof item !== 'string')) {
    return `${label} must contain only text`;
  }

  const unique = new Map<string, string>();
  for (const raw of value as string[]) {
    const item = raw.trim();
    if (!item) continue;
    if (item.length > PUBLIC_PROFILE_ITEM_MAX) {
      return `${label} entries must be ${PUBLIC_PROFILE_ITEM_MAX} characters or fewer`;
    }
    const key = item.toLocaleLowerCase('en-IN');
    if (!unique.has(key)) unique.set(key, item);
  }

  const items = [...unique.values()];
  if (items.length > PUBLIC_PROFILE_LIST_MAX) {
    return `${label} can contain at most ${PUBLIC_PROFILE_LIST_MAX} entries`;
  }
  return items.length > 0 ? items : null;
}

export function parsePublicProfilePatch(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A public profile update is required' };
  }

  const input = body as Record<string, unknown>;
  const value: PublicProfilePatch = {};

  if (Object.hasOwn(input, 'description')) {
    if (input.description !== null && typeof input.description !== 'string') {
      return { ok: false, error: 'Description must be text' };
    }
    const description =
      typeof input.description === 'string' ? input.description.trim() : '';
    if (description.length > PUBLIC_PROFILE_DESCRIPTION_MAX) {
      return {
        ok: false,
        error: `Description must be ${PUBLIC_PROFILE_DESCRIPTION_MAX} characters or fewer`,
      };
    }
    value.description = description || null;
  }

  for (const [inputKey, outputKey, label] of [
    ['areasServed', 'areasServed', 'Areas served'],
    ['propertyExpertise', 'propertyExpertise', 'Property expertise'],
  ] as const) {
    if (!Object.hasOwn(input, inputKey)) continue;
    const parsed = parseList(input[inputKey], label);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    value[outputKey] = parsed;
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'No public profile fields were provided' };
  }

  return { ok: true, value };
}
