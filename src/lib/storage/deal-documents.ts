// ============================================================
// Staging a deal document in the `deal-documents` bucket.
//
// The same shape as chat-media.ts, for the same reason: a serverless
// function caps a request body at 4.5 MB, which is an eleventh of the
// 50 MB this folder accepts, so a scanned deed larger than that is
// refused at the edge before any route runs and the caller sees a
// dropped connection rather than a refusal it can explain.
//
// The server signs one upload for one path under the account's own deal
// folder and the client PUTs the file to storage directly. The bucket is
// private, so nothing here hands out a readable link — that stays with
// the per-document route, which signs a short-lived one.
// ============================================================

import { DEAL_DOCUMENT_BUCKET } from '@/lib/invoices/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface SignedDealDocumentUpload {
  /** Absolute Supabase Storage URL; PUT the bytes here. */
  uploadUrl: string;
  /** Bucket-relative path, the shape `deal_documents.storage_path` holds. */
  storagePath: string;
}

/** What the bucket actually holds at a staged path. */
export interface StagedDealDocument {
  size: number;
  mimeType: string;
}

/**
 * Namespaced by account and deal so one deal's papers cannot be reached
 * by guessing at another's, even if a signed URL leaks.
 */
export function dealDocumentObjectPath(
  accountId: string,
  dealId: string,
  filename: string | undefined
): string {
  const safeName = (filename || 'document')
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .slice(-80);
  return `${accountId}/${dealId}/${Date.now()}-${safeName}`;
}

/**
 * Sign one upload into this deal's folder.
 *
 * The path is chosen here and carried in the signature, so the URL
 * authorises exactly one object and the client cannot redirect it at
 * another account's — or another deal's — folder.
 */
export async function signDealDocumentUpload(
  accountId: string,
  dealId: string,
  filename: string | undefined
): Promise<SignedDealDocumentUpload> {
  const objectPath = dealDocumentObjectPath(accountId, dealId, filename);

  const { data, error } = await supabaseAdmin()
    .storage.from(DEAL_DOCUMENT_BUCKET)
    .createSignedUploadUrl(objectPath);

  if (error || !data) {
    throw new Error(
      `Could not sign a deal document upload: ${error?.message ?? 'no URL returned'}`
    );
  }

  return {
    uploadUrl: data.signedUrl,
    storagePath: `${DEAL_DOCUMENT_BUCKET}/${objectPath}`,
  };
}

/**
 * The object behind a staged `storage_path`, or null when the upload
 * never landed.
 *
 * The row records the file's size and type, and the extractor reads it
 * back later — so neither can be taken from the client now that the
 * server no longer writes the bytes itself.
 */
export async function stagedDealDocument(
  storagePath: string
): Promise<StagedDealDocument | null> {
  const objectName = storagePath.slice(`${DEAL_DOCUMENT_BUCKET}/`.length);
  const segments = objectName.split('/');
  const name = segments.pop();
  if (!name) return null;

  const { data, error } = await supabaseAdmin()
    .storage.from(DEAL_DOCUMENT_BUCKET)
    .list(segments.join('/'), { search: name, limit: 1 });

  if (error) {
    throw new Error(`Could not read the staged document: ${error.message}`);
  }

  const row = data?.find((object) => object.name === name);
  if (!row) return null;

  const metadata = row.metadata as
    | { size?: number; mimetype?: string }
    | null
    | undefined;

  return {
    size: Number(metadata?.size ?? 0),
    mimeType: String(metadata?.mimetype ?? ''),
  };
}
