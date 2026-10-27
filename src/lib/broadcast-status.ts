/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Dark-theme only — bg-*-500/10 + text-*-400 + border-*-500/20.
 */

import type { BroadcastStatus, RecipientStatus } from '@/types';

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: 'Draft',
    classes: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  },
  scheduled: {
    label: 'Scheduled',
    classes: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  sending: {
    label: 'Sending',
    classes: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    pulse: true,
  },
  sent: {
    label: 'Sent',
    classes: 'bg-primary/10 text-primary border-primary/20',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  rate_limited: {
    label: 'Rate Limited',
    classes: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  },
  pending: {
    label: 'Pending',
    classes: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  },
  sent: {
    label: 'Sent',
    classes: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  delivered: {
    label: 'Delivered',
    classes: 'bg-primary/10 text-primary border-primary/20',
  },
  read: {
    label: 'Read',
    classes: 'bg-primary/10 text-primary border-primary/20',
  },
  replied: {
    label: 'Replied',
    classes: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}

/** The recipient status filter, in the order both surfaces list it. */
export const RECIPIENT_STATUS_FILTERS: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
  'rate_limited',
];

export const BROADCAST_DELETE_CONFIRM = 'Delete this broadcast?';

export const RETRYABLE_RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'failed',
  'rate_limited',
];

/** Retry failed is offered while any recipient failed or was rate-limited. */
export function hasRetryableRecipients(
  recipients: readonly { status: string }[]
): boolean {
  return recipients.some((r) =>
    (RETRYABLE_RECIPIENT_STATUSES as readonly string[]).includes(r.status)
  );
}

export interface RetryFailedResult {
  retried: number;
  succeeded?: number;
  failed?: number;
  rateLimited?: number;
}

/** What POST /api/broadcasts/[id]/retry-failed did, in one sentence. */
export function retryFailedSummary(result: RetryFailedResult): string {
  if (!result.retried) return 'No retryable recipients found';
  const rateLimited = result.rateLimited ?? 0;
  return (
    `Retried ${result.retried} recipient${result.retried !== 1 ? 's' : ''}: ` +
    `${result.succeeded ?? 0} sent, ${result.failed ?? 0} failed` +
    (rateLimited > 0 ? `, ${rateLimited} rate-limited (will retry again)` : '')
  );
}
