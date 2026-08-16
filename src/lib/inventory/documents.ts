// ============================================================
// Property document list parsing.
//
// `properties.documents` is a TEXT[] whose entries are either a bare
// storage path or a JSON blob carrying a display title — the property
// form has written both shapes over time. Every surface that renders
// documents has to cope with both.
// ============================================================

import { storagePublicUrl } from '@/lib/storage/url';

/** Upload ceiling for a property document, matching both the
 *  property-documents bucket (migration 285) and WhatsApp's own
 *  document limit — so a brochure Meta was willing to deliver to the
 *  intake bot is never one storage then refuses to keep. */
export const DOCUMENT_SIZE_LIMIT = 100 * 1024 * 1024;

export interface PropertyDocument {
  url: string;
  title: string;
}

/** Strips the `doc-<timestamp>-<nonce>-` prefix the upload helpers put on
 *  a stored filename, so a document with no title still reads as its
 *  original name rather than as upload plumbing. */
export function documentDisplayName(url: string, index: number): string {
  const filename = url.split('/').pop()?.split('?')[0] || '';
  const decoded = decodeURIComponent(filename);
  const cleaned = decoded
    .replace(/^(img-|doc-|file-)\d+-[a-zA-Z0-9]+-/, '')
    .replace(/^(img-|doc-|file-)\d+-/, '');
  return cleaned || `Document ${index + 1}`;
}

export function parsePropertyDocuments(
  documents: string[] | null | undefined
): PropertyDocument[] {
  if (!Array.isArray(documents)) return [];
  return documents
    .filter((doc) => doc?.trim())
    .map((doc) => {
      if (doc.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(doc);
          return {
            url: storagePublicUrl(parsed.url || ''),
            title: parsed.title || '',
          };
        } catch {
          // Not JSON after all — fall through to the plain path.
        }
      }
      return { url: storagePublicUrl(doc), title: '' };
    })
    .filter((d) => d.url.length > 0);
}
