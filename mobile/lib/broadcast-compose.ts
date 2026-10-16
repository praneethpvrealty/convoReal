// Pure helpers behind the mobile broadcast composer. The server owns
// everything that matters — POST /api/broadcasts picks the template,
// resolves the audience, writes the recipient rows, enforces the rate
// limit and does the sending — so this file only shapes the payload it
// expects. The message copy, preview and refusal wording come from
// @shared/lib/broadcasts/carrier-template.
//
// Mirrors the audience types in src/lib/broadcasts/sender.ts.

import {
  MAX_CSV_CONTACTS,
  parseCsvAudience,
  type CsvAudienceContact,
} from '@shared/lib/broadcasts/csv-audience';

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  excludeTagIds?: string[];
  csvContacts?: CsvAudienceContact[];
}

/**
 * Country code a local number in a pasted CSV is dialled under. The
 * mobile twin of the web's NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: a deployment
 * outside India sets both, or a local number becomes an Indian one.
 */
export const CSV_DEFAULT_COUNTRY_CODE =
  process.env.EXPO_PUBLIC_DEFAULT_COUNTRY_CODE?.replace(/\D/g, '') || '91';

export interface CsvAudienceDraft {
  contacts: CsvAudienceContact[];
  skipped: number;
  overCap: boolean;
}

export function buildAudience(
  type: 'all' | 'tags',
  tagIds: string[],
  excludeTagIds: string[]
): AudienceConfig {
  const audience: AudienceConfig = { type };
  if (type === 'tags') audience.tagIds = tagIds;
  if (excludeTagIds.length > 0) audience.excludeTagIds = excludeTagIds;
  return audience;
}

export function readCsvAudience(
  text: string,
  defaultCountryCode: string = CSV_DEFAULT_COUNTRY_CODE
): CsvAudienceDraft {
  const { contacts, skipped } = parseCsvAudience(text, defaultCountryCode);
  return { contacts, skipped, overCap: contacts.length > MAX_CSV_CONTACTS };
}

export function buildCsvAudience(
  draft: CsvAudienceDraft,
  excludeTagIds: string[]
): AudienceConfig | null {
  if (draft.contacts.length === 0 || draft.overCap) return null;
  const audience: AudienceConfig = {
    type: 'csv',
    csvContacts: draft.contacts,
  };
  if (excludeTagIds.length > 0) audience.excludeTagIds = excludeTagIds;
  return audience;
}

export interface BroadcastDraft {
  name: string;
  message: string;
  audience: AudienceConfig | null;
  optedInOnly: boolean;
}

/**
 * True when anything the confirmation would send differs from what the
 * agent was shown. The audience is compared by identity: the composer
 * replaces, never mutates, so a new object is an edit.
 */
export function draftChanged(
  confirmed: BroadcastDraft,
  current: BroadcastDraft
): boolean {
  return (
    confirmed.name !== current.name ||
    confirmed.message !== current.message ||
    confirmed.audience !== current.audience ||
    confirmed.optedInOnly !== current.optedInOnly
  );
}
