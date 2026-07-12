import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageCleanupConfig } from './image-cleanup-config';
import { notifyOwnerImageCleanup } from './image-cleanup-notify';

/**
 * Property image cleanup engine — the reversible state machine behind the
 * cleanup cron. Advances rows one phase per run:
 *
 *   active → warned → dereferenced → purged
 *
 * plus an escape hatch: a `warned` property whose owner re-activated it
 * (status no longer terminal) is reset to `active`. `dereference` keeps the
 * blobs and snapshots the URLs to image_cleanup_log; `purge` (opt-in) is the
 * only step that deletes blobs. Every phase honours `dry_run` (compute +
 * report, mutate nothing) and `max_per_run` (blast-radius cap), and is
 * idempotent (guarded state transitions make re-runs safe).
 */

const BUCKET = 'property-images';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupSummary {
  dryRun: boolean;
  warned: number;
  dereferenced: number;
  purged: number;
  reset: number;
  errors: number;
  accountsNotified: number;
}

interface PropRow {
  id: string;
  account_id: string;
  title: string;
  status: string;
  images: string[] | null;
  images_cleanup_warned_at: string | null;
  images_dereferenced_at: string | null;
}

/** Reverse a public URL to its bucket key (`<accountId>/img-...`). */
export function extractStoragePath(url: string): string | null {
  try {
    const marker = `/public/${BUCKET}/`;
    const idx = new URL(url).pathname.indexOf(marker);
    if (idx === -1) return null;
    return new URL(url).pathname.slice(idx + marker.length);
  } catch {
    return null;
  }
}

function hasImages(r: PropRow): boolean {
  return Array.isArray(r.images) && r.images.length > 0;
}

/** Best-effort audit row. Returns false if the write failed — callers that
 *  are about to destroy the only copy of the data (dereference) must gate
 *  on this. */
async function logPhase(
  admin: SupabaseClient,
  accountId: string,
  propertyId: string,
  phase: string,
  imageCount: number,
  snapshot: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await admin.from('image_cleanup_log').insert({
    account_id: accountId,
    property_id: propertyId,
    phase,
    image_count: imageCount,
    snapshot,
  });
  if (error) {
    console.error(`[image-cleanup] audit insert failed (${phase}):`, error.message);
    return false;
  }
  return true;
}

export async function runImageCleanup(
  admin: SupabaseClient,
  config: ImageCleanupConfig,
): Promise<CleanupSummary> {
  const summary: CleanupSummary = {
    dryRun: config.dry_run,
    warned: 0,
    dereferenced: 0,
    purged: 0,
    reset: 0,
    errors: 0,
    accountsNotified: 0,
  };
  const now = Date.now();
  const terminal = config.terminal_statuses;
  const isTerminal = (status: string) => terminal.includes(status);

  // ── Escape reset + dereference (both from the `warned` set) ───────────────
  const graceCutoff = new Date(now - config.grace_days * DAY_MS).toISOString();
  const { data: warnedRows, error: warnedErr } = await admin
    .from('properties')
    .select(
      'id, account_id, title, status, images, images_cleanup_warned_at, images_dereferenced_at',
    )
    .eq('images_cleanup_state', 'warned')
    .limit(config.max_per_run);
  if (warnedErr) {
    console.error('[image-cleanup] warned query failed:', warnedErr.message);
    summary.errors++;
  }

  for (const r of (warnedRows ?? []) as PropRow[]) {
    // Escape: owner re-activated it (or emptied its images) — free it.
    if (!isTerminal(r.status) || !hasImages(r)) {
      if (config.dry_run) {
        summary.reset++;
        continue;
      }
      const { error } = await admin
        .from('properties')
        .update({ images_cleanup_state: 'active', images_cleanup_warned_at: null })
        .eq('id', r.id)
        .eq('images_cleanup_state', 'warned');
      if (error) {
        summary.errors++;
        continue;
      }
      await logPhase(admin, r.account_id, r.id, 'reset', r.images?.length ?? 0, {
        status: r.status,
      });
      summary.reset++;
      continue;
    }

    // Not yet past the grace period — leave it warned.
    if (!r.images_cleanup_warned_at || r.images_cleanup_warned_at > graceCutoff) {
      continue;
    }

    // Dereference: snapshot FIRST (the only record of the URLs once cleared),
    // then clear the array. Never clear if the snapshot didn't persist.
    if (config.dry_run) {
      summary.dereferenced++;
      continue;
    }
    const snapped = await logPhase(
      admin,
      r.account_id,
      r.id,
      'dereference',
      r.images!.length,
      { images: r.images, status: r.status },
    );
    if (!snapped) {
      summary.errors++;
      continue;
    }
    const { error } = await admin
      .from('properties')
      .update({
        images: [],
        images_cleanup_state: 'dereferenced',
        images_dereferenced_at: new Date(now).toISOString(),
      })
      .eq('id', r.id)
      .eq('images_cleanup_state', 'warned');
    if (error) {
      summary.errors++;
      continue;
    }
    summary.dereferenced++;
  }

  // ── Warn: active + terminal + long-dormant + has images ───────────────────
  const warnCutoff = new Date(now - config.warn_after_days * DAY_MS).toISOString();
  const { data: activeRows, error: activeErr } = await admin
    .from('properties')
    .select('id, account_id, title, status, images')
    .eq('images_cleanup_state', 'active')
    .in('status', terminal)
    .lte('status_changed_at', warnCutoff)
    .limit(config.max_per_run);
  if (activeErr) {
    console.error('[image-cleanup] active query failed:', activeErr.message);
    summary.errors++;
  }
  const toWarn = ((activeRows ?? []) as PropRow[]).filter(hasImages);

  if (config.dry_run) {
    summary.warned += toWarn.length;
  } else {
    const warnedByAccount = new Map<string, { title: string }[]>();
    for (const r of toWarn) {
      const { error } = await admin
        .from('properties')
        .update({
          images_cleanup_state: 'warned',
          images_cleanup_warned_at: new Date(now).toISOString(),
        })
        .eq('id', r.id)
        .eq('images_cleanup_state', 'active');
      if (error) {
        summary.errors++;
        continue;
      }
      await logPhase(admin, r.account_id, r.id, 'warn', r.images!.length, {
        images: r.images,
        status: r.status,
      });
      summary.warned++;
      const list = warnedByAccount.get(r.account_id) ?? [];
      list.push({ title: r.title });
      warnedByAccount.set(r.account_id, list);
    }

    // One summary notification per account.
    const archiveDate = new Date(now + config.grace_days * DAY_MS);
    for (const [accountId, props] of warnedByAccount) {
      await notifyOwnerImageCleanup(admin, accountId, props, archiveDate);
      summary.accountsNotified++;
    }
  }

  // ── Purge: dereferenced + past final retention (opt-in only) ──────────────
  if (config.hard_delete_enabled) {
    const purgeCutoff = new Date(
      now - config.final_retention_days * DAY_MS,
    ).toISOString();
    const { data: derefRows, error: derefErr } = await admin
      .from('properties')
      .select('id, account_id')
      .eq('images_cleanup_state', 'dereferenced')
      .lte('images_dereferenced_at', purgeCutoff)
      .limit(config.max_per_run);
    if (derefErr) {
      console.error('[image-cleanup] dereferenced query failed:', derefErr.message);
      summary.errors++;
    }

    for (const r of (derefRows ?? []) as { id: string; account_id: string }[]) {
      // Recover the original URLs from the dereference snapshot.
      const { data: logRow } = await admin
        .from('image_cleanup_log')
        .select('snapshot')
        .eq('property_id', r.id)
        .eq('phase', 'dereference')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const urls: string[] =
        (logRow as { snapshot?: { images?: string[] } } | null)?.snapshot?.images ??
        [];
      const paths = urls.map(extractStoragePath).filter(Boolean) as string[];

      if (config.dry_run) {
        summary.purged++;
        continue;
      }
      if (paths.length > 0) {
        const { error } = await admin.storage.from(BUCKET).remove(paths);
        if (error) {
          console.error(`[image-cleanup] blob delete failed for ${r.id}:`, error.message);
          summary.errors++;
          continue;
        }
      }
      const { error } = await admin
        .from('properties')
        .update({ images_cleanup_state: 'purged' })
        .eq('id', r.id)
        .eq('images_cleanup_state', 'dereferenced');
      if (error) {
        summary.errors++;
        continue;
      }
      await logPhase(admin, r.account_id, r.id, 'purge', paths.length, { paths });
      summary.purged++;
    }
  }

  return summary;
}
