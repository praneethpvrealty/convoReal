import type { AudienceConfig } from '@/lib/broadcasts/sender';

const MAX_SELECTED_CONTACTS = 1000;

export type GreetingAudienceResult =
  | { audience: AudienceConfig }
  | { error: string };

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

export function parseGreetingAudience(input: unknown): GreetingAudienceResult {
  if (input === undefined || input === null) {
    return { audience: { type: 'all' } };
  }
  if (typeof input !== 'object') {
    return { error: 'Choose a valid greeting audience' };
  }

  const value = input as Record<string, unknown>;
  const excludeTagIds = stringIds(value.excludeTagIds);

  if (value.type === 'all') {
    return {
      audience: {
        type: 'all',
        excludeTagIds: excludeTagIds.length > 0 ? excludeTagIds : undefined,
      },
    };
  }

  if (value.type === 'tags') {
    const tagIds = stringIds(value.tagIds);
    return tagIds.length > 0
      ? {
          audience: {
            type: 'tags',
            tagIds,
            excludeTagIds:
              excludeTagIds.length > 0 ? excludeTagIds : undefined,
          },
        }
      : { error: 'Pick at least one tag for a tag audience' };
  }

  if (value.type === 'contacts') {
    const contactIds = stringIds(value.contactIds);
    if (contactIds.length === 0) {
      return { error: 'Pick at least one contact for a selected audience' };
    }
    if (contactIds.length > MAX_SELECTED_CONTACTS) {
      return {
        error: `You can select up to ${MAX_SELECTED_CONTACTS} contacts at a time`,
      };
    }
    return { audience: { type: 'contacts', contactIds } };
  }

  return { error: 'Choose a valid greeting audience' };
}
