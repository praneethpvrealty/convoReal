export const SHOWCASE_LISTED_STATUSES = ['Available', 'Under Contract'];

export function isListedOnShowcase(property: {
  is_published?: boolean | null;
  status?: string | null;
}): boolean {
  return (
    property.is_published === true &&
    SHOWCASE_LISTED_STATUSES.includes(property.status ?? '')
  );
}
