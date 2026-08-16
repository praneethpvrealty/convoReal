// ============================================================
// Property document list parsing.
//
// `properties.documents` is a TEXT[] whose entries are either a bare
// storage path or a JSON blob carrying a display title — the property
// form has written both shapes over time. Every surface that renders
// documents has to cope with both.
// ============================================================

import { storagePublicUrl } from '@/lib/storage/url';

/**
 * Upload ceiling for a property document.
 *
 * The real limit is the LOWER of the bucket's file_size_limit and the
 * project-wide upload limit, and the project one wins here: the bucket
 * is set to 100 MB (migration 285) but a Supabase free plan caps the
 * project at 50 MB, so 51 MB is refused with EntityTooLarge however the
 * bucket is configured. Measured, not assumed — 50 MB uploads, 51 MB
 * does not.
 *
 * Raise this to 100 MB (matching the bucket, and WhatsApp's own
 * document limit) once the project is on a plan whose upload limit has
 * been lifted past it. Nothing else needs to change: uploadPropertyDocument()
 * also catches storage's own refusal, so an over-ceiling file is
 * reported as too large either way.
 */
export const DOCUMENT_SIZE_LIMIT = 50 * 1024 * 1024;

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
