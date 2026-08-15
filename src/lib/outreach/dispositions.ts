/**
 * Conversation dispositions — what a voice call actually produced,
 * beyond whether it connected (docs/post-call-followup-plan.md §3.2).
 *
 * The provider reports `disposition` explicitly; when it doesn't, the
 * qualification block it already sends implies one. Unknown values
 * normalise to null rather than inventing behaviour — a call with no
 * recognisable disposition gets no follow-up, not a guessed one.
 */

import type { Qualification } from '@/lib/voice/campaigns';

export const DISPOSITIONS = [
  'qualified',
  'budget_mismatch_open',
  'budget_mismatch_closed',
  'requirement_changed',
  'not_now',
  'already_bought',
  'just_browsing',
  'wants_site_visit',
  'wants_details',
  'wants_human',
  'language_barrier',
  'do_not_call',
  'is_agent_broker',
  'has_property_to_sell',
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

const DISPOSITION_SET = new Set<string>(DISPOSITIONS);

export function isDisposition(value: unknown): value is Disposition {
  return typeof value === 'string' && DISPOSITION_SET.has(value);
}

/**
 * The call's disposition: the provider's explicit field when it names
 * one from the closed set, else derived from the qualification block
 * the agent already returns. `do_not_call` always wins — an explicit
 * opt-out overrides whatever else the agent labelled the call.
 */
export function resolveDisposition(
  raw: unknown,
  qualification: Qualification | null
): Disposition | null {
  if (qualification?.doNotCall) return 'do_not_call';
  if (isDisposition(raw)) return raw;
  if (!qualification) return null;
  if (qualification.budgetConfirmed === true) return 'qualified';
  if (qualification.budgetConfirmed === false) {
    return qualification.wantsAlternatives === false
      ? 'budget_mismatch_closed'
      : 'budget_mismatch_open';
  }
  return null;
}
