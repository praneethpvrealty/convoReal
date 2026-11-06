export function contactFormPayloadPropertyIds(
  loaded: boolean,
  propertyIds: readonly string[]
): { property_ids?: string[] } {
  return loaded ? { property_ids: [...propertyIds] } : {};
}
