/**
 * Pure logic for qualification call campaigns
 * (docs/voice-agent-integration-plan.md §6). DB access stays in the
 * routes; everything here is deterministic and unit-tested.
 */

export const CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RECIPIENT_FINAL_STATUSES = [
  'completed',
  'no_answer',
  'failed',
  'opted_out',
] as const;

/** Recipients stuck in 'calling' longer than this (no webhook ever
 *  arrived — the call never happened or the result was lost) are
 *  requeued by the dispatcher. */
export const STALE_CALLING_MS = 2 * 60 * 60 * 1000;

const IST_OFFSET_MINUTES = 330;

/** The hour-of-day in IST for a given instant. Campaign call windows
 *  are IST regardless of server timezone — the callers are in India. */
export function istHour(now: Date): number {
  const minutes =
    now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MINUTES;
  return Math.floor((minutes % (24 * 60)) / 60);
}

/** Whether `now` falls inside a campaign's [start, end) IST call
 *  window. An inverted or empty window never matches — a misconfigured
 *  campaign must not call at 3am. */
export function isWithinCallWindow(
  now: Date,
  startHour: number,
  endHour: number
): boolean {
  if (startHour >= endHour) return false;
  const hour = istHour(now);
  return hour >= startHour && hour < endHour;
}

/** The recipient status a finished call resolves to. Unanswered calls
 *  requeue until the attempt budget is spent; `attempts` is the count
 *  including the attempt that produced this outcome. */
export function nextRecipientStatus(
  outcome: string,
  attempts: number,
  maxAttempts: number
): 'completed' | 'queued' | 'no_answer' | 'failed' {
  if (outcome === 'connected' || outcome === 'callback_requested')
    return 'completed';
  if (outcome === 'wrong_number') return 'failed';
  return attempts >= maxAttempts ? 'no_answer' : 'queued';
}

export interface Qualification {
  budgetConfirmed: boolean | null;
  statedBudget: number | null;
  statedAreas: string[];
  wantsAlternatives: boolean | null;
  doNotCall: boolean;
}

const QUAL_AREA_MAX = 80;
const QUAL_AREAS_MAX_COUNT = 10;

/** Normalise the webhook's `qualification` block; null when absent or
 *  not an object. */
export function parseQualification(raw: unknown): Qualification | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const budget = Number(q.stated_budget);
  const areas = Array.isArray(q.stated_areas)
    ? [
        ...new Set(
          q.stated_areas
            .map((a) =>
              typeof a === 'string' ? a.trim().slice(0, QUAL_AREA_MAX) : ''
            )
            .filter(Boolean)
        ),
      ].slice(0, QUAL_AREAS_MAX_COUNT)
    : [];
  return {
    budgetConfirmed:
      typeof q.budget_confirmed === 'boolean' ? q.budget_confirmed : null,
    statedBudget: Number.isFinite(budget) && budget > 0 ? budget : null,
    statedAreas: areas,
    wantsAlternatives:
      typeof q.wants_alternatives === 'boolean' ? q.wants_alternatives : null,
    doNotCall: q.do_not_call === true,
  };
}

/** Tags a qualification result earns the contact. */
export function qualificationTags(q: Qualification): string[] {
  if (q.budgetConfirmed === true) return ['Qualified'];
  if (q.budgetConfirmed === false) return ['Budget Mismatch'];
  return [];
}
