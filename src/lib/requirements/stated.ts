/**
 * A stated requirement is one written in words, by the client or by the
 * agent: the demands statement, or an active requirement profile's
 * text once the caller has resolved which brief is active. A card that
 * carries only extracted preferences, a budget or tags is not.
 *
 * Imported by the mobile bundle through `@shared/`, so it stays free of
 * imports.
 */
export function hasRequirementText(source: {
  requirements?: string | null;
}): boolean {
  return Boolean(source.requirements?.trim());
}
