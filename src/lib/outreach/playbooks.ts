/**
 * Post-call playbooks: (flow_kind, disposition) → what happens on
 * WhatsApp and in the CRM after a voice call ends
 * (docs/post-call-followup-plan.md §4). Pure and versioned in git, the
 * same choice ENGINE_TEMPLATES made — the dispatcher owns the sending
 * and every safety gate; this module only decides.
 *
 * `buyer_qualification` is the first flow kind; owner onboarding is
 * designed to be a second entry in PLAYBOOKS and nothing else.
 */

import type { Disposition } from '@/lib/outreach/dispositions';

export const FLOW_KINDS = ['buyer_qualification', 'owner_onboarding'] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

/**
 * - `matches`  — the rich follow-up: a shortlist ranked at the stated
 *                requirement, opener-gated when the window is shut.
 * - `note`     — one short courtesy message, window-only: never worth
 *                spending a template on.
 * - `handoff`  — name the agent in writing and put a task on them.
 * - `checkin`  — thank now, go quiet, resurface on `scheduled_for`.
 * - `none`     — deliberately nothing on WhatsApp.
 */
export type PlaybookAction =
  | 'matches'
  | 'note'
  | 'handoff'
  | 'checkin'
  | 'none';

export interface PlaybookEntry {
  action: PlaybookAction;
  /** Tags the disposition itself earns, beyond qualificationTags. */
  tags?: string[];
  /** Title for a todo on the contact's agent; `{name}` interpolated. */
  task?: string;
  /** Days until the dated re-engagement fires (checkin only). */
  checkinDays?: number;
}

/** How long "not now" stays quiet when the lead named no date. Long
 *  enough to be a genuine pause, short enough to still be in market. */
export const DEFAULT_CHECKIN_DAYS = 30;

const BUYER_QUALIFICATION: Record<Disposition, PlaybookEntry> = {
  qualified: { action: 'matches', task: 'Hot lead {name} — call to close' },
  budget_mismatch_open: { action: 'matches' },
  budget_mismatch_closed: { action: 'note' },
  requirement_changed: { action: 'matches' },
  not_now: { action: 'checkin', checkinDays: DEFAULT_CHECKIN_DAYS },
  already_bought: { action: 'note' },
  just_browsing: { action: 'none' },
  wants_site_visit: {
    action: 'handoff',
    task: '{name} asked for a site visit — fix a slot',
  },
  wants_details: {
    action: 'handoff',
    task: '{name} asked for documents/details — send them',
  },
  wants_human: {
    action: 'handoff',
    task: '{name} asked for a person — call within the hour',
  },
  language_barrier: { action: 'none', tags: ['Language Barrier'] },
  do_not_call: { action: 'none' },
  is_agent_broker: { action: 'none', tags: ['Broker'] },
  has_property_to_sell: {
    action: 'none',
    tags: ['Owner Lead'],
    task: '{name} has a property to sell — start owner onboarding',
  },
};

const PLAYBOOKS: Record<
  FlowKind,
  Partial<Record<Disposition, PlaybookEntry>>
> = {
  buyer_qualification: BUYER_QUALIFICATION,
  owner_onboarding: {},
};

/** The playbook decision, or null when this flow has nothing for the
 *  disposition — silence is a legitimate outcome, not a fallback. */
export function resolvePlaybook(
  flowKind: FlowKind,
  disposition: Disposition
): PlaybookEntry | null {
  return PLAYBOOKS[flowKind][disposition] ?? null;
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || 'there';
}

export interface FollowUpContext {
  contactName: string | null;
  agentName: string | null;
  budgetText: string | null;
  areasText: string | null;
}

/** A rupee figure as a person says it — "₹9 Cr", "₹80 L" — and a
 *  range when both ends were stated. Null when the call captured no
 *  budget. */
export function formatBudgetINR(
  min: number | null | undefined,
  max: number | null | undefined
): string | null {
  const asWords = (n: number): string =>
    n >= 10000000
      ? `₹${(n / 10000000).toFixed(2).replace(/\.?0+$/, '')} Cr`
      : n >= 100000
        ? `₹${(n / 100000).toFixed(2).replace(/\.?0+$/, '')} L`
        : `₹${n.toLocaleString('en-IN')}`;
  if (min && max)
    return min === max ? asWords(max) : `${asWords(min)}–${asWords(max)}`;
  if (max) return asWords(max);
  if (min) return asWords(min);
  return null;
}

/** What the lead stated, phrased for a sentence — "₹9 Cr around HSR
 *  Layout" — or empty when the call captured neither. */
export function statedBrief(ctx: FollowUpContext): string {
  const parts = [
    ctx.budgetText,
    ctx.areasText ? `around ${ctx.areasText}` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

/** The courtesy note for `note` dispositions. Window-only by design:
 *  the dispatcher never spends a template on these. */
export function buildCloseNote(
  disposition: Disposition,
  ctx: FollowUpContext
): string {
  const name = firstName(ctx.contactName);
  if (disposition === 'already_bought') {
    return `Congratulations on your new home, ${name}! 🎉 If you or anyone you know is looking again, we're one message away.`;
  }
  return `Thanks for your time, ${name}. We'll leave it here for now — if your plans change, we're one message away.`;
}

export function buildHandoffMessage(ctx: FollowUpContext): string {
  const name = firstName(ctx.contactName);
  const agent = ctx.agentName?.trim();
  return agent
    ? `Thanks for speaking with us, ${name}. ${agent} from our team will reach out to you shortly right here on WhatsApp.`
    : `Thanks for speaking with us, ${name}. One of our team will reach out to you shortly right here on WhatsApp.`;
}

export function buildCheckinAck(ctx: FollowUpContext): string {
  const name = firstName(ctx.contactName);
  return `Understood, ${name} — we won't crowd you. We'll check in once, closer to when you're ready. If anything changes sooner, we're one message away.`;
}

/** The matches follow-up when nothing in live inventory fits: honest,
 *  and it keeps the door open without pitching. */
export function buildNoMatchesFollowUp(ctx: FollowUpContext): string {
  const name = firstName(ctx.contactName);
  const brief = statedBrief(ctx);
  const noted = brief ? ` — noted: ${brief}` : '';
  return `Thanks for speaking with us, ${name}${noted}. Nothing in our live listings fits that exactly right now, but new ones come in every week — the moment one matches, you'll hear from us right here.`;
}

/** The dated re-engagement itself, sent when `scheduled_for` arrives.
 *  Rides behind the opener when the window has shut by then. */
export function buildCheckinMessage(ctx: FollowUpContext): string {
  const name = firstName(ctx.contactName);
  const brief = statedBrief(ctx);
  return brief
    ? `Hi ${name}, checking in as promised — still looking at ${brief}? If yes, I'll send you the closest current options. If not, just say so and we'll leave you be.`
    : `Hi ${name}, checking in as promised — still on the lookout? If yes, I'll send you the closest current options. If not, just say so and we'll leave you be.`;
}
