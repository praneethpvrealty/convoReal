import { getSystemSetting } from '@/lib/system-settings';

/**
 * Tunables for the property image cleanup lifecycle, stored as a single
 * JSONB blob under the `image_cleanup_config` key in `system_settings`.
 * Follows the getSandboxSystemConfig precedent: a stored partial is
 * merged over safe defaults, so an operator can enable the feature by
 * setting just `{ "enabled": true }` and inherit sane values for the rest.
 *
 * Defaults are deliberately inert: disabled, and even once enabled it runs
 * dry (observe-only) with hard-delete off. Nothing irreversible happens
 * until the operator opts in.
 */
export interface ImageCleanupConfig {
  /** Master switch. When false the cron returns `{ skipped: 'disabled' }`. */
  enabled: boolean;
  /** Compute and report candidates but make no DB/storage/notification changes. */
  dry_run: boolean;
  /** Days a property must sit in a terminal status before the owner is warned. */
  warn_after_days: number;
  /** Days between the warning and de-referencing the images. */
  grace_days: number;
  /** Days a de-referenced property waits before its blobs are hard-deleted. */
  final_retention_days: number;
  /** Opt-in for the only irreversible step (Phase C). */
  hard_delete_enabled: boolean;
  /** Blast-radius cap: max rows advanced per phase per run. */
  max_per_run: number;
  /** Statuses that make a listing eligible (long-dormant, not active). */
  terminal_statuses: string[];
}

export const DEFAULT_IMAGE_CLEANUP_CONFIG: ImageCleanupConfig = {
  enabled: false,
  dry_run: true,
  warn_after_days: 120,
  grace_days: 30,
  final_retention_days: 180,
  hard_delete_enabled: false,
  max_per_run: 200,
  terminal_statuses: ['Sold', 'Archived', 'Rejected', 'Off Market'],
};

export async function getImageCleanupConfig(): Promise<ImageCleanupConfig> {
  const stored =
    await getSystemSetting<Partial<ImageCleanupConfig>>('image_cleanup_config');
  return { ...DEFAULT_IMAGE_CLEANUP_CONFIG, ...(stored ?? {}) };
}
