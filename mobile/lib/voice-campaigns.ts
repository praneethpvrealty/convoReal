// ------------------------------------------------------------------
// Voice qualification campaigns — types and pure presentation logic
// for the list and detail screens. The campaigns themselves live
// behind /api/voice-campaigns (web parity: the "Voice Calls" tab on
// /broadcasts); this module stays RN-free so it runs under the plain
// Node vitest runner.
// ------------------------------------------------------------------

import { formatInr } from './format';

export interface VoiceRecipientCounts {
  queued?: number;
  calling?: number;
  completed?: number;
  no_answer?: number;
  failed?: number;
  opted_out?: number;
}

export type VoiceCampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

export interface VoiceCampaign {
  id: string;
  name: string;
  property_id: string | null;
  agent_ref: string | null;
  status: VoiceCampaignStatus;
  call_window_start_hour: number;
  call_window_end_hour: number;
  max_attempts: number;
  script_context: Record<string, string>;
  created_at: string;
  recipient_counts: VoiceRecipientCounts;
}

export interface VoiceQualification {
  budgetConfirmed: boolean | null;
  statedBudget: number | null;
  statedAreas: string[];
  wantsAlternatives: boolean | null;
  doNotCall: boolean;
}

export interface VoiceRecipient {
  id: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  qualification: VoiceQualification | null;
  contact:
    | { id: string; name: string | null; phone: string | null }
    | { id: string; name: string | null; phone: string | null }[]
    | null;
}

export interface VoiceCampaignDetail extends Omit<
  VoiceCampaign,
  'recipient_counts'
> {
  recipients: VoiceRecipient[];
}

/** Supabase renders a to-one join as object or single-element array
 *  depending on the client; normalise to one shape. */
export function recipientContact(r: VoiceRecipient) {
  return Array.isArray(r.contact) ? (r.contact[0] ?? null) : r.contact;
}

export function campaignTotals(counts: VoiceRecipientCounts): {
  total: number;
  done: number;
  reached: number;
} {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const done =
    (counts.completed ?? 0) +
    (counts.no_answer ?? 0) +
    (counts.failed ?? 0) +
    (counts.opted_out ?? 0);
  return { total, done, reached: counts.completed ?? 0 };
}

export function windowLabel(start: number, end: number): string {
  const pad = (h: number) => String(h).padStart(2, '0');
  return `${pad(start)}:00–${pad(end)}:00 IST`;
}

/** One-line qualification readout for a recipient row; null when the
 *  call produced no signal yet. */
export function qualificationLabel(
  q: VoiceQualification | null
): string | null {
  if (!q) return null;
  if (q.doNotCall) return 'Do not call';
  if (q.budgetConfirmed === true) return 'Qualified';
  if (q.budgetConfirmed === false) {
    const parts = ['Mismatch'];
    if (q.statedBudget) parts.push(formatInr(q.statedBudget));
    if (q.statedAreas.length > 0) parts.push(q.statedAreas.join(', '));
    return parts.join(' · ');
  }
  return null;
}
