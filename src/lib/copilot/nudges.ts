import type { SupabaseClient } from '@supabase/supabase-js';
import { loadExpiringSessions, loadHotGoingQuiet } from '@/lib/today/queries';
import { loadMatchEvents } from '@/lib/radar/queries';
import type { LanguageCode } from '@/lib/languages';
import { nudgeCopy, type NudgeId } from './nudge-copy';

type DB = SupabaseClient;

/**
 * Rule-based proactive nudges — zero AI cost. Each rule reuses an
 * existing query module (Today / Radar / Pulse) or a cheap head-count,
 * fires when its threshold is met, and renders template copy. The
 * client shows at most one nudge per day (cooldowns live client-side
 * in per-account localStorage, mirroring the onboarding pattern).
 */
export interface CopilotNudge {
  /** Stable id used for per-nudge cooldown dedupe on the client. */
  id: NudgeId;
  /** Lower = more urgent. */
  priority: number;
  message: string;
  cta?: { label: string; href?: string; tourId?: string };
}

interface NudgeSignal {
  id: NudgeId;
  priority: number;
  count: number;
  cta?: { href?: string; tourId?: string };
}

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

type Rule = (db: DB, accountId: string) => Promise<NudgeSignal | null>;

const rules: Rule[] = [
  // 1. WhatsApp windows closing soon — the most time-critical signal.
  async (db) => {
    const items = await loadExpiringSessions(db);
    const closing = items.filter(
      (i) => new Date(i.expiresAt).getTime() - Date.now() <= 6 * HOUR_MS
    ).length;
    if (closing === 0) return null;
    return {
      id: 'sessions-expiring',
      priority: 1,
      count: closing,
      cta: { href: '/inbox' },
    };
  },
  // 2. Hot leads going quiet.
  async (db) => {
    const leads = await loadHotGoingQuiet(db);
    if (leads.length === 0) return null;
    return {
      id: 'hot-leads-quiet',
      priority: 2,
      count: leads.length,
      cta: { href: '/dashboard?tab=focus' },
    };
  },
  // 3. Journey branches that have not moved in a week. Head-count
  //    only — RLS scopes the rows and none cross the wire.
  async (db, accountId) => {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const { count, error } = await db
      .from('journey_items')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'active')
      .eq('hidden', false)
      .lt('updated_at', since);
    if (error) throw error;
    if ((count ?? 0) === 0) return null;
    return {
      id: 'journeys-stalled',
      priority: 3,
      count: count ?? 0,
      cta: { href: '/deals?view=journey' },
    };
  },
  // 4. Fresh buyer↔property matches.
  async (db) => {
    const matches = await loadMatchEvents(db);
    if (matches.length === 0) return null;
    return {
      id: 'radar-matches',
      priority: 4,
      count: matches.length,
      cta: { href: '/dashboard?tab=radar' },
    };
  },
  // 5. Property views this week (RLS scopes showcase_events; a
  //    head-count keeps it cheap — no rows cross the wire).
  async (db) => {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const { count, error } = await db
      .from('showcase_events')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since);
    if (error) throw error;
    if ((count ?? 0) < 3) return null;
    return {
      id: 'pulse-weekly-views',
      priority: 5,
      count: count ?? 0,
      cta: { tourId: 'check-property-views' },
    };
  },
  // 6–8. Setup gaps (same head-counts as /api/onboarding/status).
  async (db, accountId) => {
    const { count, error } = await db
      .from('whatsapp_config')
      .select('phone_number_id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (error) throw error;
    if ((count ?? 0) > 0) return null;
    return {
      id: 'setup-whatsapp',
      priority: 6,
      count: 0,
      cta: { tourId: 'connect-whatsapp' },
    };
  },
  async (db, accountId) => {
    const { count, error } = await db
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (error) throw error;
    if ((count ?? 0) > 0) return null;
    return {
      id: 'setup-property',
      priority: 7,
      count: 0,
      cta: { tourId: 'add-property' },
    };
  },
  async (db, accountId) => {
    const { count, error } = await db
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (error) throw error;
    if ((count ?? 0) > 0) return null;
    return {
      id: 'setup-contact',
      priority: 8,
      count: 0,
      cta: { tourId: 'add-contact' },
    };
  },
  // 9. Portal email leads not wired up. Only fires once WhatsApp is
  //    connected — before that, the setup-whatsapp nudge is the ask.
  async (db, accountId) => {
    const { count: waCount, error: waError } = await db
      .from('whatsapp_config')
      .select('phone_number_id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (waError) throw waError;
    if ((waCount ?? 0) === 0) return null;
    const { count, error } = await db
      .from('email_sync_configs')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('is_active', true);
    if (error) throw error;
    if ((count ?? 0) > 0) return null;
    return {
      id: 'setup-email-leads',
      priority: 9,
      count: 0,
      cta: { tourId: 'email-lead-sync' },
    };
  },
  // 10. Showcase still on default branding. Only fires once there are
  //    properties — branding matters when links are being shared.
  async (db, accountId) => {
    const { count: propCount, error: propError } = await db
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (propError) throw propError;
    if ((propCount ?? 0) === 0) return null;
    const { count, error } = await db
      .from('showcase_settings')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (error) throw error;
    if ((count ?? 0) > 0) return null;
    return {
      id: 'setup-showcase-brand',
      priority: 10,
      count: 0,
      cta: { href: '/settings?tab=showcase' },
    };
  },
];

function render(signal: NudgeSignal, language: LanguageCode): CopilotNudge {
  const copy = nudgeCopy(signal.id, signal.count, language);
  return {
    id: signal.id,
    priority: signal.priority,
    message: copy.message,
    cta: signal.cta ? { label: copy.ctaLabel, ...signal.cta } : undefined,
  };
}

/**
 * Runs every rule; one slow or failing rule never blanks the list
 * (Promise.allSettled). Returns the top 3 by priority, worded in the
 * caller's UI language (English for anything untranslated).
 */
export async function evaluateNudges(
  db: DB,
  accountId: string,
  language: LanguageCode = 'en'
): Promise<CopilotNudge[]> {
  const results = await Promise.allSettled(rules.map((r) => r(db, accountId)));
  const nudges: NudgeSignal[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) nudges.push(r.value);
    else if (r.status === 'rejected') {
      console.warn('[Copilot] nudge rule failed:', r.reason);
    }
  }
  return nudges
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((signal) => render(signal, language));
}
