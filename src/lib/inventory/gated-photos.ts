// ============================================================
// Photo custody for confidential listings (migration 255).
//
// A photo in the public `property-images` bucket resolves to a direct
// CDN URL. Nothing of ours sits in that request path, so such a photo
// cannot be watermarked, cannot expire, and cannot be recalled — which
// makes it the wrong home for a listing the owner asked us to keep
// quiet. The non-public bucket is the right home: the only way out of
// it is the token proxy, which stamps the viewer's masked number on
// every frame it serves and re-checks the grant on every request.
//
// So the confidential switch moves custody rather than merely hiding a
// field. Turning it on locks the listing's photos; turning it off
// restores exactly the ones it locked, leaving hand-locked photos
// alone (that is what `gated_locked_images` is for).
//
// The move mirrors the per-photo lock in
// /api/properties/[id]/private-images: download, upload under the same
// key, then rewrite the arrays. The key is preserved so a half-finished
// move is re-runnable rather than corrupting.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { storageObjectPath } from '@/lib/storage/url';

export const PUBLIC_BUCKET = 'property-images';
export const PRIVATE_BUCKET = 'property-images-private';

export interface PhotoCustodyRow {
  images?: string[] | null;
  private_images?: string[] | null;
  gated_locked_images?: string[] | null;
}

/** The arrays a custody change writes back. */
export interface PhotoCustodyUpdate {
  images: string[];
  private_images: string[];
  gated_locked_images: string[];
}

const list = (v: string[] | null | undefined): string[] =>
  Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p.trim()) : [];

/** Bucket-relative form, or '' when the value is not a usable path.
 *  Comparing on '' would make two unusable paths look equal, so every
 *  caller filters those out before comparing. */
const objPath = (v: string | null | undefined): string =>
  storageObjectPath(v) ?? '';

const has = (arr: string[], path: string): boolean => {
  const target = objPath(path);
  return target !== '' && arr.some((v) => objPath(v) === target);
};

/**
 * Where a photo ends up after a lock/unlock, given its current path.
 * Returns null when the path does not live in the bucket the direction
 * expects — a photo already on the far side is not an error, it is
 * simply nothing to do.
 */
export function retargetPath(
  path: string,
  direction: 'lock' | 'unlock'
): { key: string; from: string; to: string; target: string } | null {
  const objectPath = objPath(path);
  const from = direction === 'lock' ? PUBLIC_BUCKET : PRIVATE_BUCKET;
  const to = direction === 'lock' ? PRIVATE_BUCKET : PUBLIC_BUCKET;
  if (!objectPath || !objectPath.startsWith(`${from}/`)) return null;
  const key = objectPath.slice(from.length + 1);
  if (!key) return null;
  return { key, from, to, target: `${to}/${key}` };
}

/**
 * The arrays after gating locks every public photo. Pure, so the
 * bookkeeping is testable without touching storage — the caller moves
 * the bytes for each path in `moved` and then writes this back.
 */
export function planLock(row: PhotoCustodyRow): {
  update: PhotoCustodyUpdate;
  moved: Array<{ from: string; to: string }>;
} {
  const images = list(row.images);
  const priv = list(row.private_images);
  const moved: Array<{ from: string; to: string }> = [];
  const nextPrivate = [...priv];
  const locked: string[] = [];

  for (const path of images) {
    const t = retargetPath(path, 'lock');
    if (!t) continue;
    moved.push({ from: path, to: t.target });
    locked.push(t.target);
    if (!has(nextPrivate, t.target)) nextPrivate.push(t.target);
  }

  return {
    update: {
      images: [],
      private_images: nextPrivate,
      // Union with anything already recorded: re-running a partly
      // applied lock must not forget the first pass.
      gated_locked_images: Array.from(
        new Set([...list(row.gated_locked_images), ...locked])
      ),
    },
    moved,
  };
}

/**
 * The arrays after un-gating restores what the gate locked. Photos the
 * agent locked by hand are absent from `gated_locked_images` and stay
 * private — un-gating must never publish a facade shot someone
 * deliberately withheld.
 */
export function planUnlock(row: PhotoCustodyRow): {
  update: PhotoCustodyUpdate;
  moved: Array<{ from: string; to: string }>;
} {
  const images = list(row.images);
  const priv = list(row.private_images);
  const gated = list(row.gated_locked_images);
  const moved: Array<{ from: string; to: string }> = [];
  const nextImages = [...images];
  let nextPrivate = [...priv];

  for (const path of gated) {
    if (!has(priv, path)) continue;
    const t = retargetPath(path, 'unlock');
    if (!t) continue;
    moved.push({ from: path, to: t.target });
    nextPrivate = nextPrivate.filter((v) => objPath(v) !== objPath(path));
    if (!has(nextImages, t.target)) nextImages.push(t.target);
  }

  return {
    update: {
      images: nextImages,
      private_images: nextPrivate,
      gated_locked_images: [],
    },
    moved,
  };
}

/**
 * Moves one object between buckets. Copy-then-delete rather than a
 * rename so a failure leaves the original readable: a listing with a
 * photo in both buckets is recoverable, one with the photo in neither
 * is not.
 */
async function moveObject(
  admin: SupabaseClient,
  fromPath: string,
  toPath: string
): Promise<boolean> {
  const from = objPath(fromPath);
  const to = objPath(toPath);
  if (!from || !to) return false;
  const fromBucket = from.split('/')[0];
  const toBucket = to.split('/')[0];
  const fromKey = from.slice(fromBucket.length + 1);
  const toKey = to.slice(toBucket.length + 1);

  const { data: file, error: dlErr } = await admin.storage
    .from(fromBucket)
    .download(fromKey);
  if (dlErr || !file) {
    console.error('[gated-photos] download failed:', from, dlErr);
    return false;
  }
  const { error: upErr } = await admin.storage
    .from(toBucket)
    .upload(toKey, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) {
    console.error('[gated-photos] upload failed:', to, upErr);
    return false;
  }
  const { error: rmErr } = await admin.storage
    .from(fromBucket)
    .remove([fromKey]);
  if (rmErr) {
    // The photo is readable at its destination and the arrays will
    // point there; a stale public copy is a leak, so this is loud.
    console.error('[gated-photos] source delete failed:', from, rmErr);
  }
  return true;
}

/**
 * Applies a confidential-switch transition to a listing's photos.
 * Returns the arrays to persist, or null when nothing needs to change.
 *
 * Only photos that actually moved are recorded, so a storage failure
 * leaves the listing consistent: the ones that made it are private and
 * tracked, the ones that did not stay public and un-tracked, and
 * re-saving retries them.
 */
export async function applyGatingCustody(
  admin: SupabaseClient,
  row: PhotoCustodyRow,
  direction: 'lock' | 'unlock'
): Promise<PhotoCustodyUpdate | null> {
  const plan = direction === 'lock' ? planLock(row) : planUnlock(row);
  if (plan.moved.length === 0) {
    // Still persist an unlock's cleared tracking list, so a listing
    // whose photos were all removed does not keep stale entries.
    if (direction === 'unlock' && list(row.gated_locked_images).length > 0) {
      return plan.update;
    }
    return null;
  }

  const failed = new Set<string>();
  for (const m of plan.moved) {
    const ok = await moveObject(admin, m.from, m.to);
    if (!ok) failed.add(objPath(m.to));
  }
  if (failed.size === 0) return plan.update;

  // Re-plan against only what moved, so the arrays never claim a photo
  // is somewhere it is not.
  const movedOk = plan.moved.filter((m) => !failed.has(objPath(m.to)));
  if (direction === 'lock') {
    const stayedPublic = list(row.images).filter(
      (p) => !movedOk.some((m) => objPath(m.from) === objPath(p))
    );
    return {
      images: stayedPublic,
      private_images: Array.from(
        new Set([...list(row.private_images), ...movedOk.map((m) => m.to)])
      ),
      gated_locked_images: Array.from(
        new Set([...list(row.gated_locked_images), ...movedOk.map((m) => m.to)])
      ),
    };
  }
  const restored = movedOk.map((m) => m.to);
  return {
    images: Array.from(new Set([...list(row.images), ...restored])),
    private_images: list(row.private_images).filter(
      (p) => !movedOk.some((m) => objPath(m.from) === objPath(p))
    ),
    // Keep tracking only what failed to come back, so a retry knows
    // there is still work rather than declaring the listing restored.
    gated_locked_images: list(row.gated_locked_images).filter((p) => {
      const t = retargetPath(p, 'unlock');
      return t ? failed.has(objPath(t.target)) : false;
    }),
  };
}
