// ------------------------------------------------------------------
// Picking a floor plan or land sketch off the phone and storing it.
//
// Shared by the standalone Floor Plans editor and the rent-roll rows,
// which store the same thing in the same place — the difference is only
// which field the returned path lands in. Kept out of both components
// so the two cannot drift on bucket, path shape or quality.
//
// Images go to `property-images`; PDF land sketches go to
// `property-documents`. Both return a bucket-relative path, the shape
// the web form writes, so either surface reads them identically.
// ------------------------------------------------------------------

import { useAuthStore } from '@/lib/auth-store';
import { LAND_SKETCH_MIME_TYPES } from '@/lib/floor-plans';
import { supabase } from '@/lib/supabase';

const IMAGE_BUCKET = 'property-images';
const DOCUMENT_BUCKET = 'property-documents';
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;
const DOCUMENT_SIZE_LIMIT = 50 * 1024 * 1024;

export type FloorPlanPickOutcome =
  | { status: 'uploaded'; path: string }
  /** Picker dismissed, or the asset had no data — say nothing. */
  | { status: 'cancelled' }
  | { status: 'error'; title: string; message?: string };

/** Module scope so the timestamp and nonce are never read during render. */
export type PlanImageKind = 'floor-plan' | 'land-sketch';

function planPath(
  accountId: string,
  kind: PlanImageKind,
  extension: string
): string {
  const rand = Math.random().toString(36).substring(2, 7);
  const prefix = kind === 'land-sketch' ? 'sketch' : 'plan';
  return `${accountId}/${prefix}-${Date.now()}-${rand}.${extension}`;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Prompts for a floor-plan image or a land-sketch image/PDF and uploads
 * it, returning the stored path.
 *
 * Every failure comes back as a value rather than a throw, so the
 * caller decides how to surface it — the two call sites render dialogs
 * differently and neither should have to wrap this in a try/catch.
 */
export async function pickAndUploadFloorPlan(
  kind: PlanImageKind = 'floor-plan'
): Promise<FloorPlanPickOutcome> {
  const label = kind === 'land-sketch' ? 'land sketch' : 'floor plan';
  const plural = kind === 'land-sketch' ? 'land sketches' : 'floor plans';
  let bytes: Uint8Array;
  let bucket = IMAGE_BUCKET;
  let extension = 'jpg';
  let contentType = 'image/jpeg';

  if (kind === 'land-sketch') {
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = await import('expo-document-picker');
    } catch {
      return {
        status: 'error',
        title: 'Update the app',
        message: `Adding ${plural} needs the latest ConvoReal build. Install the newest version, then try again.`,
      };
    }
    let result: Awaited<ReturnType<typeof DocumentPicker.getDocumentAsync>>;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: [...LAND_SKETCH_MIME_TYPES],
        copyToCacheDirectory: true,
      });
    } catch (e) {
      return {
        status: 'error',
        title: 'Could not open files',
        message: e instanceof Error ? e.message : 'Please try again.',
      };
    }
    if (result.canceled || !result.assets?.length) {
      return { status: 'cancelled' };
    }
    const asset = result.assets[0];
    const isPdf =
      asset.mimeType === 'application/pdf' || /\.pdf$/i.test(asset.name);
    try {
      const response = await fetch(asset.uri);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      return {
        status: 'error',
        title: 'Could not read that file',
        message: 'Choose the sketch again and retry.',
      };
    }
    const sizeLimit = isPdf ? DOCUMENT_SIZE_LIMIT : IMAGE_SIZE_LIMIT;
    if (bytes.byteLength > sizeLimit) {
      return {
        status: 'error',
        title: 'File too large',
        message: `${isPdf ? 'PDF sketches' : 'Sketch images'} can be up to ${Math.round(sizeLimit / (1024 * 1024))} MB.`,
      };
    }
    if (isPdf) {
      bucket = DOCUMENT_BUCKET;
      extension = 'pdf';
      contentType = 'application/pdf';
    } else {
      const imageTypes: Record<
        string,
        { extension: string; contentType: string }
      > = {
        'image/jpeg': { extension: 'jpg', contentType: 'image/jpeg' },
        'image/png': { extension: 'png', contentType: 'image/png' },
        'image/webp': { extension: 'webp', contentType: 'image/webp' },
      };
      const inferredType = /\.png$/i.test(asset.name)
        ? 'image/png'
        : /\.webp$/i.test(asset.name)
          ? 'image/webp'
          : /\.jpe?g$/i.test(asset.name)
            ? 'image/jpeg'
            : '';
      const imageType = imageTypes[asset.mimeType || inferredType];
      if (!imageType) {
        return {
          status: 'error',
          title: 'Unsupported file',
          message: 'Choose a PDF, JPG, PNG or WebP sketch.',
        };
      }
      extension = imageType.extension;
      contentType = imageType.contentType;
    }
  } else {
    // Loaded lazily so an older installed build that predates this native
    // module degrades to a prompt instead of crashing at import time.
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      return {
        status: 'error',
        title: 'Update the app',
        message: `Adding ${plural} needs the latest ConvoReal build. Install the newest version, then try again.`,
      };
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return {
        status: 'error',
        title: 'Permission needed',
        message: `Allow photo access to add a ${label}.`,
      };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return { status: 'cancelled' };

    const asset = result.assets[0];
    if (!asset?.base64) return { status: 'cancelled' };

    bytes = decodeBase64(asset.base64);
    if (bytes.byteLength > IMAGE_SIZE_LIMIT) {
      return {
        status: 'error',
        title: 'File too large',
        message: 'Floor plan images can be up to 5 MB.',
      };
    }
  }

  const accountId = useAuthStore.getState().profile?.account_id;
  if (!accountId) return { status: 'error', title: 'Not signed in' };

  try {
    const path = planPath(accountId, kind, extension);
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, bytes.buffer as ArrayBuffer, {
        contentType,
        upsert: true,
        cacheControl: '3600',
      });
    if (error) throw new Error(error.message);
    return { status: 'uploaded', path: `${bucket}/${path}` };
  } catch (e) {
    return {
      status: 'error',
      title: 'Upload failed',
      message: e instanceof Error ? e.message : 'Please try again.',
    };
  }
}
