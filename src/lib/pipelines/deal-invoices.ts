export const INVOICE_BUCKET = 'deal-invoices';

/** Matches the bucket's file_size_limit in migration 20260914114500. */
export const INVOICE_SIZE_LIMIT = 10 * 1024 * 1024;

/** How long a minted read link stays valid. Long enough to open or
 *  download the file, short enough that a copied URL is not a leak. */
export const INVOICE_URL_TTL_SECONDS = 60 * 10;

export const INVOICE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export interface DealInvoice {
  path: string;
  name: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface DealInvoiceLink extends DealInvoice {
  url: string | null;
}

export function rejectInvoiceFile(
  mimeType: string,
  size: number
): { error: string; code: string; status: number } | null {
  if (!(INVOICE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return {
      error: 'Invoices must be a PDF, an image, or a Word/Excel file.',
      code: 'UNSUPPORTED_TYPE',
      status: 415,
    };
  }
  if (size <= 0) {
    return { error: 'That file is empty.', code: 'EMPTY_FILE', status: 400 };
  }
  if (size > INVOICE_SIZE_LIMIT) {
    return {
      error: `Invoices can be up to ${Math.round(INVOICE_SIZE_LIMIT / (1024 * 1024))} MB.`,
      code: 'FILE_TOO_LARGE',
      status: 413,
    };
  }
  return null;
}

/** Keeps the original filename readable while stripping anything that
 *  could reshape the object key — separators, traversal, control bytes. */
export function safeInvoiceFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(-80);
  return cleaned || 'invoice';
}

export function invoiceObjectPath(
  accountId: string,
  dealId: string,
  filename: string
): string {
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${accountId}/${dealId}/${Date.now()}-${nonce}-${safeInvoiceFilename(filename)}`;
}

/** An object path belongs to a deal only when it sits under that deal's
 *  folder in that account's folder. The delete handler checks this
 *  before it hands anything to the service-role client. */
export function isOwnedInvoicePath(
  path: string,
  accountId: string,
  dealId: string
): boolean {
  return !path.includes('..') && path.startsWith(`${accountId}/${dealId}/`);
}

/** `deals.invoices` is JSONB written only by the invoices route, but a
 *  hand-edited row or a partial write should degrade to "no invoice",
 *  never to a crash on a screen that only wanted to list them. */
export function parseDealInvoices(value: unknown): DealInvoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const path = typeof row.path === 'string' ? row.path.trim() : '';
    if (!path) return [];
    return [
      {
        path,
        name:
          typeof row.name === 'string' && row.name.trim()
            ? row.name.trim()
            : invoiceDisplayName(path),
        size: typeof row.size === 'number' ? row.size : 0,
        uploaded_at: typeof row.uploaded_at === 'string' ? row.uploaded_at : '',
        uploaded_by:
          typeof row.uploaded_by === 'string' ? row.uploaded_by : null,
      },
    ];
  });
}

/** Strips the `<timestamp>-<nonce>-` prefix the upload adds, so a file
 *  reads as the name the agent picked it under. */
export function invoiceDisplayName(path: string): string {
  const filename = path.split('/').pop() ?? '';
  return filename.replace(/^\d{10,}-[a-z0-9]{4,8}-/, '') || 'Invoice';
}
