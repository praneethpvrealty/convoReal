// Pure helpers behind the mobile broadcast composer. The server owns
// everything that matters — POST /api/broadcasts resolves the audience,
// writes the recipient rows, enforces the rate limit and does the
// sending — so this file only shapes the payload it expects.
//
// Mirrors the types in src/lib/broadcasts/sender.ts.

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  excludeTagIds?: string[];
}

/** Contact columns a placeholder can be filled from on mobile. */
export const CONTACT_FIELDS = [
  { value: 'name', label: 'Contact name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
] as const;

/**
 * Placeholder keys in a template body, in the order Meta numbers them.
 * "Hi {{1}}, {{2}} is available" → ["1", "2"]. Duplicates collapse: the
 * same placeholder twice is still one value to fill in.
 */
export function templateVariableKeys(bodyText?: string | null): string[] {
  if (!bodyText) return [];
  const found = new Set<string>();
  for (const match of bodyText.matchAll(/\{\{(\d+)\}\}/g)) {
    found.add(match[1]);
  }
  return [...found].sort((a, b) => Number(a) - Number(b));
}

/**
 * Default each placeholder to the contact's name. It is what {{1}} is
 * in nearly every approved template, and a mapping that is wrong is
 * visible in the preview, whereas an unset one silently sends the raw
 * "{{1}}" to every recipient.
 */
export function defaultVariableMappings(keys: string[]): Record<string, VariableMapping> {
  const mappings: Record<string, VariableMapping> = {};
  for (const key of keys) {
    mappings[key] = { type: 'field', value: 'name' };
  }
  return mappings;
}

/**
 * What one recipient would see, for the preview. `field` mappings show
 * the sample contact's value; a blank static reads as its placeholder
 * so an unfilled slot is obvious before sending.
 */
export function previewBody(
  bodyText: string,
  variables: Record<string, VariableMapping>,
  sample: Record<string, string | null | undefined>,
): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, key: string) => {
    const mapping = variables[key];
    if (!mapping) return match;
    if (mapping.type === 'static') return mapping.value.trim() || match;
    if (mapping.type === 'field') return (sample[mapping.value] || '').trim() || match;
    return match;
  });
}

/** True when every placeholder resolves to something non-empty. */
export function mappingsComplete(
  keys: string[],
  variables: Record<string, VariableMapping>,
): boolean {
  return keys.every((key) => {
    const mapping = variables[key];
    if (!mapping) return false;
    if (mapping.type === 'static') return mapping.value.trim().length > 0;
    return mapping.value.trim().length > 0;
  });
}

export function buildAudience(
  type: 'all' | 'tags',
  tagIds: string[],
  excludeTagIds: string[],
): AudienceConfig {
  const audience: AudienceConfig = { type };
  if (type === 'tags') audience.tagIds = tagIds;
  if (excludeTagIds.length > 0) audience.excludeTagIds = excludeTagIds;
  return audience;
}
