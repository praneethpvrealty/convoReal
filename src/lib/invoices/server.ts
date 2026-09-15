/**
 * Server-side invoice plumbing.
 *
 * Everything here needs a database or a storage bucket, which is why it
 * lives apart from the pure modules beside it — those run in a test and
 * on mobile's behalf without either.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/supabase/admin';

import { financialYearFor } from './financial-year';
import { hashInvoicePdf, renderInvoicePdf } from './pdf';
import type { JpegImage } from './pdf-writer';
import type {
  Invoice,
  InvoiceEventName,
  InvoiceSettings,
  InvoiceStatus,
} from './types';

export const SIGNATURE_BUCKET = 'signatures';
export const INVOICE_BUCKET = 'generated-invoices';
export const DEAL_DOCUMENT_BUCKET = 'deal-documents';

/** Signed URLs live an hour: long enough for Meta to fetch the document
 *  at send time, short enough that a leaked link is not a standing one. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * The account's invoice settings, creating the row on first use.
 *
 * An account that has never opened the settings screen can still raise
 * an invoice — it just comes out on defaults with an empty letterhead,
 * which is visible and fixable, rather than failing at the point an
 * agent is trying to bill someone.
 */
export async function getOrCreateInvoiceSettings(
  supabase: SupabaseClient,
  accountId: string
): Promise<InvoiceSettings> {
  const { data, error } = await supabase
    .from('invoice_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error)
    throw new Error(`Could not read invoice settings: ${error.message}`);
  if (data) return data as InvoiceSettings;

  const { data: created, error: insertError } = await supabase
    .from('invoice_settings')
    .insert({ account_id: accountId })
    .select('*')
    .single();

  if (insertError) {
    // A parallel request may have created it first.
    const { data: existing } = await supabase
      .from('invoice_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (existing) return existing as InvoiceSettings;
    throw new Error(
      `Could not create invoice settings: ${insertError.message}`
    );
  }

  return created as InvoiceSettings;
}

/**
 * Take the next number in the account's series.
 *
 * Goes through the database function rather than reading and writing a
 * counter here: it locks the settings row, so two agents pressing Issue
 * at the same instant queue instead of both being handed 102.
 */
export async function allocateInvoiceNumber(
  supabase: SupabaseClient,
  accountId: string,
  invoiceDate: string
): Promise<{
  sequenceNumber: number;
  invoiceNumber: string;
  financialYear: string;
}> {
  const financialYear = financialYearFor(invoiceDate);

  const { data, error } = await supabase.rpc('allocate_invoice_number', {
    p_account_id: accountId,
    p_financial_year: financialYear,
  });

  if (error) {
    throw new Error(`Could not allocate an invoice number: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invoice_number) {
    throw new Error('Could not allocate an invoice number.');
  }

  return {
    sequenceNumber: Number(row.sequence_number),
    invoiceNumber: String(row.invoice_number),
    financialYear,
  };
}

/**
 * Fetch and downscale the account's signature image as JPEG.
 *
 * `sharp` is already the project's imaging library and is server-only,
 * which is exactly why the conversion happens here: it keeps `pdf.ts`
 * able to embed one format it can pass straight through, instead of
 * teaching it PNG colour types and alpha channels.
 *
 * A missing or unreadable signature is not an error — the invoice still
 * renders, just without the image over the signatory line.
 */
export async function loadSignatureImage(
  storagePath: string | null | undefined
): Promise<JpegImage | null> {
  if (!storagePath) return null;

  const relative = storagePath.startsWith(`${SIGNATURE_BUCKET}/`)
    ? storagePath.slice(SIGNATURE_BUCKET.length + 1)
    : storagePath;

  try {
    const { data, error } = await supabaseAdmin()
      .storage.from(SIGNATURE_BUCKET)
      .download(relative);
    if (error || !data) return null;

    const sharp = (await import('sharp')).default;
    const input = Buffer.from(await data.arrayBuffer());
    // Flattened onto white because a JPEG has no alpha, and a signature
    // is almost always a transparent PNG — without this the transparent
    // areas come out black.
    const image = sharp(input).flatten({ background: '#ffffff' });
    const meta = await image.metadata();
    const jpeg = await image
      .resize(600, 220, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8Array(jpeg.data),
      width: jpeg.info.width || meta.width || 300,
      height: jpeg.info.height || meta.height || 100,
    };
  } catch {
    return null;
  }
}

/**
 * Render an invoice to PDF, with its signature image if it has one.
 *
 * Always regenerated from the frozen snapshot rather than served from
 * storage, so a stored copy can never drift from the record.
 */
export async function renderInvoice(
  invoice: Invoice,
  options: { signatureImage?: JpegImage | null } = {}
): Promise<{
  pdf: Uint8Array;
  hash: string;
  /** Whether a signature image was actually drawn on the page. The
   *  caller needs this to decide whether the invoice may claim to be
   *  signed — see `resolveSignatureImage`. */
  signatureApplied: boolean;
}> {
  const mode = invoice.signature?.mode;
  const signatureImage =
    options.signatureImage !== undefined
      ? options.signatureImage
      : mode === 'image'
        ? await loadSignatureImage(invoice.signature?.image_path)
        : null;

  const pdf = renderInvoicePdf(invoice, {
    signatureImage,
    reserveSignatureField: mode === 'dsc' || mode === 'esign',
  });

  return {
    pdf,
    hash: hashInvoicePdf(pdf),
    signatureApplied: Boolean(signatureImage),
  };
}

/**
 * Whether this invoice can honestly say it was signed.
 *
 * `loadSignatureImage` returns null both when no signature has been
 * uploaded and when the stored object cannot be read, and neither is a
 * signature. Marking the invoice signed anyway prints "Electronically
 * signed on <date>" over an empty line — an assertion about a legal
 * document that nothing backs. So the image is resolved first and the
 * signed state follows from it, not the other way round.
 */
export async function resolveSignatureImage(
  invoice: Invoice
): Promise<JpegImage | null> {
  if (invoice.signature?.mode !== 'image') return null;
  return loadSignatureImage(invoice.signature?.image_path);
}

/** Store a rendered copy so a delivery channel has something to link. */
export async function storeInvoicePdf(
  accountId: string,
  invoiceId: string,
  pdf: Uint8Array
): Promise<string> {
  const path = `${accountId}/${invoiceId}.pdf`;
  const { error } = await supabaseAdmin()
    .storage.from(INVOICE_BUCKET)
    .upload(path, Buffer.from(pdf), {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '0',
    });
  if (error)
    throw new Error(`Could not store the invoice PDF: ${error.message}`);
  return `${INVOICE_BUCKET}/${path}`;
}

/** A short-lived link to an object in one of the private buckets. */
export async function signedUrlFor(
  bucket: string,
  storagePath: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const relative = storagePath.startsWith(`${bucket}/`)
    ? storagePath.slice(bucket.length + 1)
    : storagePath;

  const { data, error } = await supabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(relative, ttlSeconds);

  return error || !data?.signedUrl ? null : data.signedUrl;
}

export interface LogEventInput {
  accountId: string;
  invoiceId: string;
  event: InvoiceEventName;
  actorId?: string | null;
  actorName?: string | null;
  request?: Request | null;
  documentHash?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record what happened to an invoice.
 *
 * This is the evidentiary half of an electronic signature: an image on
 * a PDF proves little by itself, and what makes it stand up is being
 * able to say who issued it, when, from where, and over exactly which
 * bytes. Written with the service-role client so a trail cannot be
 * suppressed by a caller's own permissions, and never allowed to fail
 * the operation it is recording — a lost audit line is worth less than
 * an invoice the agent could not issue.
 */
export async function logInvoiceEvent(input: LogEventInput): Promise<void> {
  try {
    await supabaseAdmin()
      .from('invoice_events')
      .insert({
        account_id: input.accountId,
        invoice_id: input.invoiceId,
        event: input.event,
        actor_id: input.actorId ?? null,
        actor_name: input.actorName ?? null,
        ip_address: clientIp(input.request),
        user_agent:
          input.request?.headers.get('user-agent')?.slice(0, 500) ?? null,
        document_hash: input.documentHash ?? null,
        metadata: input.metadata ?? {},
      });
  } catch (err) {
    console.error('[logInvoiceEvent] could not record event:', err);
  }
}

function clientIp(request: Request | null | undefined): string | null {
  if (!request) return null;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return request.headers.get('x-real-ip')?.slice(0, 64) ?? null;
}

/**
 * Which status changes are allowed.
 *
 * An issued invoice never returns to draft: the number is spent and the
 * customer may already hold a copy, so the only way back is a
 * cancellation that leaves the number standing.
 */
export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['sent', 'paid', 'cancelled'],
  sent: ['paid', 'cancelled'],
  paid: ['cancelled'],
  cancelled: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A draft is the only editable state — everything else is a record. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === 'draft';
}
