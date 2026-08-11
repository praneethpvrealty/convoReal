// ------------------------------------------------------------------
// Property-document helpers — pure, so they run under the plain Node
// test runner (same split as home-widgets.ts and menu.ts).
//
// Documents are stored as bucket-relative paths — "property-documents/
// <account>/<stamp>-<name>.pdf" — the same shape the web form writes,
// so a file added from either surface reads identically on the other.
// ------------------------------------------------------------------

/** Upload ceiling for a property document. Deliberately below the
 *  WhatsApp attachment limit: these go to Supabase storage, not to
 *  Meta, and a 100 MB scan over mobile data is a stuck spinner rather
 *  than a feature. */
export const DOCUMENT_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * Filename to show for a stored document path.
 *
 * Strips the bucket and account folder, then the upload timestamp
 * prefix the uploader adds, and restores the underscores the path
 * sanitiser substituted for spaces. A path that does not match the
 * expected shape falls back to its last segment rather than rendering
 * empty.
 */
export function documentLabel(path: string): string {
  const last = path.split('/').filter(Boolean).pop() ?? path;
  const withoutStamp = last.replace(/^\d{10,}-/, '');
  const name = withoutStamp || last;
  return name.replace(/_/g, ' ');
}
