// ============================================================
// Staging an inbox attachment in the `chat-media` bucket.
//
// The bytes never pass through this app. A serverless function caps a
// request body at 4.5 MB, which is below every limit the composer
// advertises — a 16 MB video and a 100 MB document are refused at the
// edge before any route runs, and the caller sees a dropped connection
// rather than a refusal it can explain. So the server signs one upload
// for one path inside the account's own prefix and the client PUTs the
// file to storage directly.
//
// What the server keeps is the part that matters: the path is ours, so
// nothing can be written outside `chat-media/<accountId>/`, and the
// send routes read back what actually landed rather than trusting the
// size the client declared.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';

export const CHAT_MEDIA_BUCKET = 'chat-media';

/** What the client is told to do with the file it picked. */
export interface SignedChatUpload {
  /** Absolute Supabase Storage URL; PUT the bytes here. */
  uploadUrl: string;
  /** Bucket-relative path, the shape `/api/whatsapp/send` expects. */
  path: string;
}

/** What the bucket actually holds at a staged path. */
export interface StagedChatMedia {
  size: number;
  mimeType: string;
}

function objectPath(
  accountId: string,
  mimeType: string,
  filename?: string
): string {
  const fromMime = mimeType.split('/')[1]?.split('+')[0].split(';')[0];
  const fromName = filename?.includes('.')
    ? filename.split('.').pop()
    : undefined;
  const ext = (fromName || fromMime || 'bin')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8);

  const randomStr = Math.random().toString(36).substring(2, 9);
  return `${accountId}/chat-${Date.now()}-${randomStr}.${ext}`;
}

/**
 * Sign one upload into this account's prefix.
 *
 * The path is chosen here and carried in the signature, so the URL
 * authorises exactly one object and the client cannot redirect it at
 * another account's folder.
 */
export async function signChatMediaUpload(
  accountId: string,
  mimeType: string,
  filename?: string
): Promise<SignedChatUpload> {
  const path = objectPath(accountId, mimeType, filename);

  const { data, error } = await supabaseAdmin()
    .storage.from(CHAT_MEDIA_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error(
      `Could not sign a chat media upload: ${error?.message ?? 'no URL returned'}`
    );
  }

  return { uploadUrl: data.signedUrl, path: `${CHAT_MEDIA_BUCKET}/${path}` };
}

/**
 * The object behind a staged `media_url`, or null when the upload never
 * landed.
 *
 * The send routes check the `chat-media/<accountId>/` prefix, which
 * proves the caller cannot name another account's file — but not that
 * the file exists, nor that it is the size it claimed when the upload
 * was signed. Meta fetches this link server-side, so both are read back
 * from storage before the send goes out.
 */
export async function stagedChatMedia(
  mediaUrl: string
): Promise<StagedChatMedia | null> {
  const objectName = mediaUrl.slice(`${CHAT_MEDIA_BUCKET}/`.length);
  const segments = objectName.split('/');
  const name = segments.pop();
  if (!name) return null;

  const { data, error } = await supabaseAdmin()
    .storage.from(CHAT_MEDIA_BUCKET)
    .list(segments.join('/'), { search: name, limit: 1 });

  if (error) {
    throw new Error(`Could not read the staged attachment: ${error.message}`);
  }

  const row = data?.find((object) => object.name === name);
  if (!row) return null;

  const metadata = row.metadata as
    { size?: number; mimetype?: string } | null | undefined;

  return {
    size: Number(metadata?.size ?? 0),
    mimeType: String(metadata?.mimetype ?? ''),
  };
}
