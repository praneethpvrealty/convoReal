import { getSystemSetting } from '@/lib/system-settings';

/**
 * Tunables for the anonymized market-stats aggregation, stored under the
 * `market_stats_config` key in `system_settings` (same inert-by-default
 * posture as image_cleanup_config): the nightly cron does nothing until
 * an operator sets `{ "enabled": true }`.
 */
export interface MarketStatsConfig {
  /** Master switch. When false the cron returns `{ skipped: 'disabled' }`. */
  enabled: boolean;
  /**
   * k-anonymity floor: a cell is only written when backed by at least
   * this many DISTINCT consenting accounts (accounts, not listings — a
   * locality cell fed by one prolific agent is identifiable regardless
   * of row count).
   */
  k_threshold: number;
  /** How many trailing month-buckets to recompute each run (full-refresh upsert). */
  months_back: number;
}

export const DEFAULT_MARKET_STATS_CONFIG: MarketStatsConfig = {
  enabled: false,
  k_threshold: 5,
  months_back: 2,
};

export async function getMarketStatsConfig(): Promise<MarketStatsConfig> {
  const stored =
    await getSystemSetting<Partial<MarketStatsConfig>>('market_stats_config');
  return { ...DEFAULT_MARKET_STATS_CONFIG, ...(stored ?? {}) };
}
