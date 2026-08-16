// ------------------------------------------------------------------
// Picking a floor plan off the phone and storing it.
//
// Shared by the standalone Floor Plans editor and the rent-roll rows,
// which store the same thing in the same place — the difference is only
// which field the returned path lands in. Kept out of both components
// so the two cannot drift on bucket, path shape or quality.
//
// Plans go to `property-images` as a bucket-relative path, the shape
// the web form writes, so a plan added from either surface reads
// identically on the other.
// ------------------------------------------------------------------

import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';

const BUCKET = 'property-images';

export type FloorPlanPickOutcome =
  | { status: 'uploaded'; path: string }
  /** Picker dismissed, or the asset had no data — say nothing. */
  | { status: 'cancelled' }
  | { status: 'error'; title: string; message?: string };

/** Module scope so the timestamp and nonce are never read during render. */
function planPath(accountId: string): string {
  const rand = Math.random().toString(36).substring(2, 7);
  return `${accountId}/plan-${Date.now()}-${rand}.jpg`;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Prompts for a plan image and uploads it, returning the stored path.
 *
 * Every failure comes back as a value rather than a throw, so the
 * caller decides how to surface it — the two call sites render dialogs
 * differently and neither should have to wrap this in a try/catch.
 */
export async function pickAndUploadFloorPlan(): Promise<FloorPlanPickOutcome> {
  // Loaded lazily so an older installed build that predates this native
  // module degrades to a prompt instead of crashing at import time.
  let ImagePicker: typeof import('expo-image-picker');
  try {
    ImagePicker = await import('expo-image-picker');
  } catch {
    return {
      status: 'error',
      title: 'Update the app',
      message:
        'Adding floor plans needs the latest ConvoReal build. Install the newest version, then try again.',
    };
  }

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return {
      status: 'error',
      title: 'Permission needed',
      message: 'Allow photo access to add a floor plan.',
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    quality: 0.8,
    base64: true,
  });
  if (result.canceled) return { status: 'cancelled' };

  const asset = result.assets[0];
  if (!asset?.base64) return { status: 'cancelled' };

  const accountId = useAuthStore.getState().profile?.account_id;
  if (!accountId) return { status: 'error', title: 'Not signed in' };

  try {
    const bytes = decodeBase64(asset.base64);
    const path = planPath(accountId);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes.buffer as ArrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600',
      });
    if (error) throw new Error(error.message);
    return { status: 'uploaded', path: `${BUCKET}/${path}` };
  } catch (e) {
    return {
      status: 'error',
      title: 'Upload failed',
      message: e instanceof Error ? e.message : 'Please try again.',
    };
  }
}
