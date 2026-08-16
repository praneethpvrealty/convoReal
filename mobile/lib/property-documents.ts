// ------------------------------------------------------------------
// Property-document helpers — pure, so they run under the plain Node
// test runner (same split as home-widgets.ts and menu.ts).
//
// Documents are stored as bucket-relative paths — "property-documents/
// <account>/<stamp>-<name>.pdf" — the same shape the web form writes,
// so a file added from either surface reads identically on the other.
// ------------------------------------------------------------------

/** Upload ceiling for a property document, matching the
 *  property-documents bucket (migration 285), the web form and
 *  WhatsApp's own document limit. A single ceiling across surfaces is
 *  what stops a brochure that uploaded fine from one client being
 *  rejected from another. */
export const DOCUMENT_SIZE_LIMIT = 100 * 1024 * 1024;

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

export interface PropertyDocument {
  /** The stored array entry, untouched — what a removal filters on. */
  raw: string;
  /** Storage path or absolute URL, ready for `storagePublicUrl()`. */
  url: string;
  /** The title typed on the form, falling back to the filename. */
  label: string;
}

/**
 * Read the `properties.documents` array.
 *
 * Entries are either a bare storage path or a JSON blob carrying a
 * display title — the web form has written both shapes over time, and
 * every surface has to cope with both (src/lib/inventory/documents.ts
 * parses the same pair). Treating a blob as a path is what sent the
 * whole JSON string into the storage URL and 404'd the bucket.
 */
export function parsePropertyDocuments(
  documents: string[] | null | undefined
): PropertyDocument[] {
  if (!Array.isArray(documents)) return [];
  return documents
    .filter((doc) => doc?.trim())
    .map((doc) => {
      const entry = doc.trim();
      if (entry.startsWith('{')) {
        try {
          const parsed = JSON.parse(entry) as {
            url?: unknown;
            title?: unknown;
          };
          const url = typeof parsed.url === 'string' ? parsed.url.trim() : '';
          const title =
            typeof parsed.title === 'string' ? parsed.title.trim() : '';
          return { raw: doc, url, label: title || documentLabel(url) };
        } catch {
          // Not JSON after all — fall through to the plain path.
        }
      }
      return { raw: doc, url: entry, label: documentLabel(entry) };
    })
    .filter((d) => d.url.length > 0);
}
