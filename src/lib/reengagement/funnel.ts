// Pure presentation logic for the re-engagement outcome report, kept
// out of the components so the funnel arithmetic and the stage each
// lead has reached are unit-testable.

import { formatShareAmount } from '@/lib/share-message-builder';
import { ENQUIRY_FOLLOWUP_TEMPLATE_NAME } from '@/lib/whatsapp/enquiry-followup-template';
import type { ReengagementLead, ReengagementSummary } from './queries';

/** The pre-rename template name. A batch sent on it is still a
 *  re-engagement batch, so the report must not drop it. Kept in sync
 *  with is_reengagement_template() in migration 212. */
const LEGACY_ENQUIRY_TEMPLATE_NAME = 'property_enquiry_followup';

/** Whether a broadcast on this template is a re-engagement batch — the
 *  client-side twin of the SQL predicate, used to decide whether the
 *  broadcast page shows the outcome panel. */
export function isReengagementTemplate(
  templateName: string | null | undefined
): boolean {
  if (!templateName) return false;
  return (
    templateName === ENQUIRY_FOLLOWUP_TEMPLATE_NAME ||
    templateName === LEGACY_ENQUIRY_TEMPLATE_NAME
  );
}

export interface FunnelStage {
  key: keyof ReengagementSummary;
  label: string;
  value: number;
  /** Share of the leads the batch went out to, 0-100. */
  percent: number;
  hint: string;
}

/**
 * The funnel in the order a lead moves through it. Percentages are of
 * total leads, not of the previous stage — an agent reading "matched
 * 12%" wants it against the list they uploaded, and stage-over-stage
 * would hide a collapse at the top.
 */
export function funnelStages(summary: ReengagementSummary): FunnelStage[] {
  const denom = summary.leads > 0 ? summary.leads : 0;
  const pct = (n: number) => (denom === 0 ? 0 : Math.round((n / denom) * 100));

  return [
    {
      key: 'sent',
      label: 'Sent',
      value: summary.sent,
      percent: pct(summary.sent),
      hint: 'Template accepted by WhatsApp for delivery.',
    },
    {
      key: 'delivered',
      label: 'Delivered',
      value: summary.delivered,
      percent: pct(summary.delivered),
      hint: 'Reached the handset.',
    },
    {
      key: 'read',
      label: 'Read',
      value: summary.read,
      percent: pct(summary.read),
      hint: 'Opened by the lead.',
    },
    {
      key: 'replied',
      label: 'Replied',
      value: summary.replied,
      percent: pct(summary.replied),
      hint: 'Tapped a button or wrote back — the 24-hour window is open.',
    },
    {
      key: 'requirementUpdated',
      label: 'Requirement updated',
      value: summary.requirementUpdated,
      percent: pct(summary.requirementUpdated),
      hint: 'Submitted the preference form, or their reply was parsed into preferences.',
    },
    {
      key: 'matched',
      label: 'Matched',
      value: summary.matched,
      percent: pct(summary.matched),
      hint: 'Radar found inventory fitting their restated requirement — ready to shortlist.',
    },
  ];
}

export type LeadStage =
  | 'matched'
  | 'updated'
  | 'replied'
  | 'delivered'
  | 'sent'
  | 'failed'
  | 'pending';

/** The furthest point this lead reached — drives the row badge. */
export function leadStage(lead: ReengagementLead): LeadStage {
  if (lead.matchCount > 0) return 'matched';
  if (lead.requirementUpdatedAt) return 'updated';
  if (lead.repliedAt || lead.status === 'replied') return 'replied';
  if (lead.status === 'failed') return 'failed';
  if (lead.status === 'read' || lead.status === 'delivered') return 'delivered';
  if (lead.status === 'sent') return 'sent';
  return 'pending';
}

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  matched: 'Matched',
  updated: 'Requirement updated',
  replied: 'Replied',
  delivered: 'Delivered',
  sent: 'Sent',
  failed: 'Failed',
  pending: 'Queued',
};

/**
 * One-line restatement of what the lead is looking for now. Empty when
 * they have told us nothing — the caller renders a dash rather than an
 * invented "Any budget, anywhere".
 */
export function requirementSummary(lead: ReengagementLead): string {
  const parts: string[] = [];

  const min = formatShareAmount(lead.budgetMin);
  const max = formatShareAmount(lead.budgetMax);
  if (min && max) parts.push(`${min} – ${max}`);
  else if (max) parts.push(`up to ${max}`);
  else if (min) parts.push(`from ${min}`);

  if (lead.areas.length > 0) {
    const shown = lead.areas.slice(0, 3).join(', ');
    const more = lead.areas.length - Math.min(lead.areas.length, 3);
    parts.push(more > 0 ? `${shown} +${more}` : shown);
  }

  return parts.join(' · ');
}

/**
 * Leads worth acting on right now: Radar has matches for them and the
 * shortlist has not been sent yet. Drives the "ready to shortlist" count
 * and the default filter.
 */
export function readyToShortlist(
  leads: ReengagementLead[]
): ReengagementLead[] {
  return leads.filter((l) => l.matchCount > 0 && l.matchEventStatus !== 'sent');
}
