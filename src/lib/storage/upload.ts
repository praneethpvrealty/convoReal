import { createClient } from '@supabase/supabase-js';

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
  
  // Resolve file extension from mime type
  let ext = 'png';
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
