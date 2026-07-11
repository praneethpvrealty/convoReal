import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let _adminClient: ReturnType<typeof createClient> | null = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

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
 * Uploads a file buffer directly to the 'property-images' Supabase storage bucket under the account's folder,
 * returning the public URL.
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

  const { data: { publicUrl } } = supabase.storage
    .from('property-images')
    .getPublicUrl(path);

  return publicUrl;
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

  const { data: { publicUrl } } = supabase.storage
    .from('property-documents')
    .getPublicUrl(path);

  return publicUrl;
}
