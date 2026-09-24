import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import {
  E_KHATA_MAX_BYTES,
  isEKhataMimeType,
  type EKhataFields,
} from '@shared/lib/inventory/e-khata-fields';

const BUCKET = 'property-documents';

export class EKhataPickError extends Error {}

/**
 * Pick an e-Khata, upload it to the listing's documents bucket and have
 * the server read it. The server attaches the file to the listing, so it
 * appears under Documents whatever the agent applies. Resolves to null
 * when the picker is dismissed.
 */
export async function pickAndReadEKhata(
  propertyId: string
): Promise<EKhataFields | null> {
  let DocumentPicker: typeof import('expo-document-picker');
  try {
    DocumentPicker = await import('expo-document-picker');
  } catch {
    throw new EKhataPickError(
      'Reading an e-Khata needs the latest ConvoReal build. Install the newest version, then try again.'
    );
  }
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const mimeType = (asset.mimeType || 'application/pdf').toLowerCase();
  if (!isEKhataMimeType(mimeType)) {
    throw new EKhataPickError('Choose the e-Khata PDF or a photo of it.');
  }

  const accountId = useAuthStore.getState().profile?.account_id;
  if (!accountId) throw new EKhataPickError('Not signed in.');

  const bytes = new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
  if (bytes.byteLength > E_KHATA_MAX_BYTES) {
    throw new EKhataPickError('That file is too large for an e-Khata.');
  }

  const safe = (asset.name || 'e-khata.pdf').replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${accountId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes.buffer as ArrayBuffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: '3600',
    });
  if (error) throw new Error(error.message);

  const res = await apiFetch<{ data: { fields: EKhataFields } }>(
    '/api/properties/e-khata',
    {
      method: 'POST',
      body: JSON.stringify({
        path: `${BUCKET}/${path}`,
        mime_type: mimeType,
        property_id: propertyId,
      }),
      timeoutMs: 90_000,
    }
  );
  return res.data.fields;
}
