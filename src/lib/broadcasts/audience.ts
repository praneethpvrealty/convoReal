import type { AudienceConfig, CustomFieldFilter } from './sender';

export const MAX_AUDIENCE_CONTACT_IDS = 1000;
export const MAX_AUDIENCE_TAG_IDS = 100;
export const MAX_CSV_CONTACTS = 5000;

const OPERATORS: readonly CustomFieldFilter['operator'][] = [
  'is',
  'is_not',
  'contains',
];

export type ParsedAudience = { audience: AudienceConfig } | { error: string };

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0
      )
    ),
  ];
}

export function parseAudience(input: unknown): ParsedAudience {
  if (!input || typeof input !== 'object') {
    return { error: 'Choose an audience' };
  }
  const value = input as Record<string, unknown>;

  const excludeTagIds = stringIds(value.excludeTagIds);
  if (excludeTagIds.length > MAX_AUDIENCE_TAG_IDS) {
    return { error: `Exclude at most ${MAX_AUDIENCE_TAG_IDS} tags` };
  }
  const exclude = excludeTagIds.length > 0 ? { excludeTagIds } : {};

  switch (value.type) {
    case 'all':
      return { audience: { type: 'all', ...exclude } };
    case 'tags': {
      const tagIds = stringIds(value.tagIds);
      if (tagIds.length === 0) return { error: 'Pick at least one tag' };
      if (tagIds.length > MAX_AUDIENCE_TAG_IDS) {
        return { error: `Pick at most ${MAX_AUDIENCE_TAG_IDS} tags` };
      }
      return { audience: { type: 'tags', tagIds, ...exclude } };
    }
    case 'contacts': {
      const contactIds = stringIds(value.contactIds);
      if (contactIds.length === 0) {
        return { error: 'Pick at least one contact' };
      }
      if (contactIds.length > MAX_AUDIENCE_CONTACT_IDS) {
        return {
          error: `You can select up to ${MAX_AUDIENCE_CONTACT_IDS} contacts at a time`,
        };
      }
      return { audience: { type: 'contacts', contactIds, ...exclude } };
    }
    case 'custom_field': {
      const field = value.customField as Record<string, unknown> | undefined;
      const fieldId = typeof field?.fieldId === 'string' ? field.fieldId : '';
      const operator = OPERATORS.find((op) => op === field?.operator);
      const fieldValue = typeof field?.value === 'string' ? field.value : '';
      if (!fieldId || !operator || !fieldValue) {
        return { error: 'Finish the custom-field filter' };
      }
      return {
        audience: {
          type: 'custom_field',
          customField: { fieldId, operator, value: fieldValue },
          ...exclude,
        },
      };
    }
    case 'csv': {
      const rows = Array.isArray(value.csvContacts) ? value.csvContacts : [];
      const csvContacts = rows.flatMap((row) => {
        const r = row as Record<string, unknown> | null;
        const phone = typeof r?.phone === 'string' ? r.phone.trim() : '';
        if (!phone) return [];
        const name = typeof r?.name === 'string' ? r.name.trim() : '';
        return [name ? { phone, name } : { phone }];
      });
      if (csvContacts.length === 0) {
        return { error: 'Add at least one phone number' };
      }
      if (csvContacts.length > MAX_CSV_CONTACTS) {
        return {
          error: `A list can hold up to ${MAX_CSV_CONTACTS.toLocaleString('en-IN')} numbers`,
        };
      }
      return { audience: { type: 'csv', csvContacts, ...exclude } };
    }
    default:
      return { error: 'Choose an audience' };
  }
}
