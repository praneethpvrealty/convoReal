import type { SupabaseClient } from '@supabase/supabase-js';
import { loadExpiringSessions, loadHotGoingQuiet } from '@/lib/today/queries';
import { loadMatchEvents } from '@/lib/radar/queries';

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
  id: string;
  /** Lower = more urgent. */
  priority: number;
  message: string;
  cta?: { label: string; href?: string; tourId?: string };
}

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

type Rule = (db: DB, accountId: string) => Promise<CopilotNudge | null>;

const rules: Rule[] = [
  // 1. WhatsApp windows closing soon — the most time-critical signal.
  async (db) => {
    const items = await loadExpiringSessions(db);
    const closing = items.filter(
      (i) => new Date(i.expiresAt).getTime() - Date.now() <= 6 * HOUR_MS,
    ).length;
    if (closing === 0) return null;
    return {
      id: 'sessions-expiring',
      priority: 1,
      message:
        closing === 1
          ? '1 customer chat will close soon — reply before the WhatsApp window ends.'
          : `${closing} customer chats will close soon — reply before the WhatsApp window ends.`,
      cta: { label: 'Open Inbox', href: '/inbox' },
    };
  },
  // 2. Hot leads going quiet.
  async (db) => {
    const leads = await loadHotGoingQuiet(db);
    if (leads.length === 0) return null;
    return {
      id: 'hot-leads-quiet',
      priority: 2,
      message:
        leads.length === 1
          ? '1 hot lead hasn’t heard from you in 2+ days. A quick message keeps them warm!'
          : `${leads.length} hot leads haven’t heard from you in 2+ days. A quick message keeps them warm!`,
      cta: { label: 'See leads', href: '/dashboard?tab=today' },
    };
  },
  // 3. Fresh buyer↔property matches.
  async (db) => {
    const matches = await loadMatchEvents(db);
    if (matches.length === 0) return null;
    return {
      id: 'radar-matches',
      priority: 3,
      message:
        matches.length === 1
          ? 'Found 1 new buyer–property match for you. Take a look!'
          : `Found ${matches.length} new buyer–property matches for you. Take a look!`,
      cta: { label: 'Open Match Radar', href: '/dashboard?tab=radar' },
    };
  },
  // 4. Property views this week (RLS scopes showcase_events, same as
  //    loadPulseStats — head-count keeps it cheap).
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
      priority: 4,
      message: `Did you know? Your properties got ${count} views this week \u{1F440}`,
      cta: { label: 'Show me', tourId: 'check-property-views' },
    };
  },
  // 5–7. Setup gaps (same head-counts as /api/onboarding/status).
  async (db, accountId) => {
    const { count, error } = await db
      .from('whatsapp_config')
      .select('phone_number_id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (error) throw error;
    if ((count ?? 0) > 0) return null;
    return {
      id: 'setup-whatsapp',
      priority: 5,
      message: 'Connect WhatsApp to unlock customer chats and broadcasts.',
      cta: { label: 'Set it up', tourId: 'connect-whatsapp' },
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
      priority: 6,
      message: 'Add your first property — it takes about a minute.',
      cta: { label: 'Show me how', tourId: 'add-property' },
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
      priority: 7,
      message: 'Add your first contact — it takes about a minute.',
      cta: { label: 'Show me how', tourId: 'add-contact' },
    };
  },
];

/**
 * Runs every rule; one slow or failing rule never blanks the list
 * (Promise.allSettled). Returns the top 3 by priority.
 */
export async function evaluateNudges(
  db: DB,
  accountId: string,
): Promise<CopilotNudge[]> {
  const results = await Promise.allSettled(rules.map((r) => r(db, accountId)));
  const nudges: CopilotNudge[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) nudges.push(r.value);
    else if (r.status === 'rejected') {
      console.warn('[Copilot] nudge rule failed:', r.reason);
    }
  }
  return nudges.sort((a, b) => a.priority - b.priority).slice(0, 3);
}
