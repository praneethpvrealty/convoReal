// ============================================================
// The one WhatsApp template every hand-written broadcast rides on.
//
// A broadcast composer that lists the account's approved templates
// asks the agent to pick between rows that exist for the Engine's own
// sends (digests, reminders, number-change notices) and a Meta
// placeholder syntax they never wrote. Nobody should have to. The
// agent writes the message and picks who gets it; the app carries it
// as {{3}} of this template, greets each recipient by name in {{1}}
// and signs it with the agency in {{2}}.
//
// Dependency-free on purpose: the mobile composer imports it through
// @shared/ for the same preview and the same refusal wording.
// ============================================================

export const BROADCAST_UPDATE_TEMPLATE_NAME = 'agency_update_notice';

/**
 * Meta caps a resolved body at 1024 characters; the fixed copy, the
 * greeting name and the agency name take the rest of that budget.
 */
export const BROADCAST_MESSAGE_MAX = 700;

export const BROADCAST_UPDATE_BODY = [
  'Hello {{1}}, here is an update from {{2}} for you.',
  '',
  '{{3}}',
  '',
  'Reply to this message if you would like to know more, and we will get back to you.',
].join('\n');

export const BROADCAST_UPDATE_FOOTER =
  'Reply STOP ALERTS to opt out of these updates';

export type BroadcastUpdateVariable =
  { type: 'static'; value: string } | { type: 'field'; value: string };

export interface BroadcastTemplateState {
  /** Meta's status for the account's row, or null when there is none. */
  status: string | null;
  rejectionReason: string | null;
  /** Why no row could be created, when the app tried and could not. */
  setupError: 'whatsapp_not_connected' | 'submission_failed' | null;
  /** The body the recipient sees, from the account's row when it has
   *  one so the preview matches what Meta approved. */
  bodyText: string;
  footerText: string | null;
  agencyName: string;
}

/** A template parameter cannot carry a newline, a tab or a run of
 *  spaces (Meta error 132018), so the message goes out as one line. */
export function singleLineMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function broadcastMessageProblem(
  message: string
): 'empty' | 'too_long' | null {
  const line = singleLineMessage(message);
  if (!line) return 'empty';
  if (line.length > BROADCAST_MESSAGE_MAX) return 'too_long';
  return null;
}

/** {{1}} resolves per recipient (greetable name fallback at send time);
 *  the agency and the message are the same for everyone. */
export function buildBroadcastUpdateVariables(
  message: string,
  agencyName: string
): Record<string, BroadcastUpdateVariable> {
  return {
    '1': { type: 'field', value: 'name' },
    '2': { type: 'static', value: singleLineMessage(agencyName) },
    '3': { type: 'static', value: singleLineMessage(message) },
  };
}

/** What one recipient will read, for the composer preview. */
export function previewBroadcastUpdate({
  bodyText = BROADCAST_UPDATE_BODY,
  message,
  agencyName,
  contactName,
}: {
  bodyText?: string;
  message: string;
  agencyName: string;
  contactName?: string | null;
}): string {
  const values: Record<string, string> = {
    '1': contactName?.trim() || 'there',
    '2': singleLineMessage(agencyName) || 'our team',
    '3': singleLineMessage(message) || 'Your message goes here.',
  };
  return bodyText.replace(
    /\{\{(\d+)\}\}/g,
    (match, key: string) => values[key] ?? match
  );
}

/**
 * Why a broadcast cannot go out right now, in the words both surfaces
 * show, or null once Meta has approved the account's row.
 */
export function broadcastTemplateBlockReason(
  state: Pick<
    BroadcastTemplateState,
    'status' | 'rejectionReason' | 'setupError'
  > | null
): string | null {
  if (!state) return null;
  if (state.status === 'APPROVED') return null;
  if (state.status === null) {
    if (state.setupError === 'whatsapp_not_connected') {
      return 'WhatsApp is not connected for this account, so broadcasts cannot be set up yet. Connect WhatsApp in Settings first.';
    }
    if (state.setupError === 'submission_failed') {
      return 'ConvoReal could not register your broadcast message with WhatsApp just now. Open this screen again in a few minutes to retry.';
    }
    return 'ConvoReal is registering your broadcast message with WhatsApp.';
  }
  if (state.status === 'PENDING') {
    return 'WhatsApp is reviewing how ConvoReal sends broadcasts from your number. Sends unlock the moment it is approved, usually within minutes to a few hours.';
  }
  if (state.status === 'REJECTED') {
    return `WhatsApp rejected the broadcast message format${state.rejectionReason ? `: ${state.rejectionReason}` : ''}. Resubmit it from Settings → Templates (${BROADCAST_UPDATE_TEMPLATE_NAME}).`;
  }
  return `The broadcast message format is not usable right now (status: ${state.status}).`;
}
