import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';

const IMAGE_MAX_WIDTH = 1200;
const JPEG_QUALITY = 75;

async function compressImage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const isImage = mimeType.startsWith('image/') && mimeType !== 'image/svg+xml' && mimeType !== 'image/gif';
  if (!isImage) return { buffer, mimeType };

  try {
    const pipeline = sharp(buffer).resize(IMAGE_MAX_WIDTH, null, { withoutEnlargement: true });

    if (mimeType === 'image/png') {
      const compressed = await pipeline.png({ quality: 80, compressionLevel: 9 }).toBuffer();
      if (compressed.length < buffer.length * 0.9) return { buffer: compressed, mimeType };
    }

    const jpeg = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    if (jpeg.length < buffer.length * 0.9) return { buffer: jpeg, mimeType: 'image/jpeg' };

    return { buffer, mimeType };
  } catch {
    return { buffer, mimeType };
  }
}

/**
 * Uploads a file buffer to the 'property-images' bucket under the
 * account's folder and returns the bucket-relative object path
 * ("property-images/<accountId>/img-...."). Resolve it to a live URL at
 * the read boundary via storagePublicUrl() — storing the path rather than
 * an absolute URL keeps stored media portable across project migrations.
 */
export async function uploadPropertyImage(
  accountId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const supabase = supabaseAdmin();

  const compressed = await compressImage(buffer, mimeType);
  buffer = compressed.buffer;
  mimeType = compressed.mimeType;

  // Resolve file extension from mime type
  let ext = 'jpg';
  if (mimeType) {
    const parts = mimeType.split('/');
    if (parts.length > 1) {
      ext = parts[1].split('+')[0]; // strip any metadata like xml+svg
    }
  }

  const randomStr = Math.random().toString(36).substring(2, 7);
  // Construct path under the account ID folder
  const path = `${accountId}/img-${Date.now()}-${randomStr}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('property-images')
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: true,
      contentType: mimeType,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  return `property-images/${path}`;
}

/**
 * Uploads a video buffer directly to the 'property-videos' Supabase storage bucket under the account's folder,
 * returning the public URL. The bucket only accepts video/mp4 (20MB cap — WhatsApp's own limit is 16MB).
 */
export async function uploadPropertyVideo(
  accountId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const supabase = supabaseAdmin();

  const randomStr = Math.random().toString(36).substring(2, 7);
  const path = `${accountId}/wa-${Date.now()}-${randomStr}.mp4`;

  const { error: uploadError } = await supabase.storage
    .from('property-videos')
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: true,
      contentType: mimeType,
    });

  if (uploadError) {
    throw new Error(`Storage video upload failed: ${uploadError.message}`);
  }

  return `property-videos/${path}`;
}

/**
 * Uploads a call recording to the PRIVATE 'call-recordings' bucket under the
 * account's folder and returns the bucket-relative object path. The bucket is
 * not public — playback goes through the authed call-log recording route,
 * which issues a short-lived signed URL.
 */
export async function uploadCallRecording(
  accountId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const supabase = supabaseAdmin();

  let ext = 'mp3';
  if (mimeType) {
    const parts = mimeType.split('/');
    if (parts.length > 1) {
      ext = parts[1].split('+')[0].split(';')[0];
    }
  }

  const randomStr = Math.random().toString(36).substring(2, 7);
  const path = `${accountId}/call-${Date.now()}-${randomStr}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: true,
      contentType: mimeType,
    });

  if (uploadError) {
    throw new Error(`Storage recording upload failed: ${uploadError.message}`);
  }

  return `call-recordings/${path}`;
}

/**
 * Uploads a file buffer directly to the 'property-documents' Supabase storage bucket under the account's folder,
 * returning the public URL.
 */
export async function uploadPropertyDocument(
  accountId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename?: string
): Promise<string> {
  const supabase = supabaseAdmin();
  
  // Resolve file extension from mime type
  let ext = 'pdf';
  if (mimeType) {
    const parts = mimeType.split('/');
    if (parts.length > 1) {
      ext = parts[1].split('+')[0]; // strip any metadata like xml+svg
    }
  }
  
  const randomStr = Math.random().toString(36).substring(2, 7);
  // Clean original filename or construct fallback
  const cleanName = originalFilename
    ? originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_')
    : `doc-${Date.now()}-${randomStr}.${ext}`;

  const path = `${accountId}/${cleanName}`;

  const { error: uploadError } = await supabase.storage
    .from('property-documents')
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: true,
      contentType: mimeType,
    });

  if (uploadError) {
    throw new Error(`Storage document upload failed: ${uploadError.message}`);
  }

  return `property-documents/${path}`;
}

/**
 * Uploads an attachment an agent is sending into a WhatsApp thread and
 * returns the bucket-relative object path.
 *
 * Images are compressed on the way through — the same pass inventory
 * photos get — because the recipient is on a phone and Meta re-encodes
 * anyway. Everything else is stored byte-for-byte: re-encoding a voice
 * note or a signed PDF would change what the customer receives.
 */
export async function uploadChatMedia(
  accountId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename?: string
): Promise<string> {
  const supabase = supabaseAdmin();

  if (mimeType.startsWith('image/')) {
    const compressed = await compressImage(buffer, mimeType);
    buffer = compressed.buffer;
    mimeType = compressed.mimeType;
  }

  const fromMime = mimeType.split('/')[1]?.split('+')[0].split(';')[0];
  const fromName = originalFilename?.includes('.')
    ? originalFilename.split('.').pop()
    : undefined;
  const ext = (fromName || fromMime || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);

  const randomStr = Math.random().toString(36).substring(2, 9);
  const path = `${accountId}/chat-${Date.now()}-${randomStr}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('chat-media')
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType,
    });

  if (uploadError) {
    throw new Error(`Storage chat media upload failed: ${uploadError.message}`);
  }

  return `chat-media/${path}`;
}
