import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchEvent } from '@/types';
import type { RadarSendRefusalCode } from './send-refusal';

export const RADAR_SEND_CLAIM_TTL_MS = 6 * 60 * 1000;

type ClaimableEvent = Pick<
  MatchEvent,
  'id' | 'status' | 'sent_count' | 'send_claimed_at' | 'sent_target_ids'
>;

export type RadarSendClaim =
  | { ok: true; claimedAt: string; deliveredIds: string[] }
  | { ok: false; code: RadarSendRefusalCode };

export function isLiveRadarSendClaim(
  claimedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!claimedAt) return false;
  const at = Date.parse(claimedAt);
  return Number.isFinite(at) && at > now.getTime() - RADAR_SEND_CLAIM_TTL_MS;
}

type ClaimState = Pick<
  MatchEvent,
  'status' | 'send_claimed_at' | 'sent_target_ids'
>;

function refusalFor(
  event: ClaimState,
  resend: boolean,
  now: Date
): RadarSendRefusalCode | null {
  if (isLiveRadarSendClaim(event.send_claimed_at, now))
    return 'SEND_IN_PROGRESS';
  if (event.status === 'sent' && !event.sent_target_ids && !resend)
    return 'ALREADY_SENT';
  return null;
}

export async function claimRadarSend(
  db: SupabaseClient,
  accountId: string,
  event: ClaimableEvent,
  { resend = false, now = new Date() }: { resend?: boolean; now?: Date } = {}
): Promise<RadarSendClaim> {
  const refused = refusalFor(event, resend, now);
  if (refused) return { ok: false, code: refused };

  const prior = event.send_claimed_at ?? null;
  const claimedAt = now.toISOString();
  const claim = db
    .from('match_events')
    .update({ send_claimed_at: claimedAt })
    .eq('id', event.id)
    .eq('account_id', accountId);
  const { data, error } = await (
    prior
      ? claim.eq('send_claimed_at', prior)
      : claim.is('send_claimed_at', null)
  )
    .select('status, sent_target_ids')
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    const { data: current } = await db
      .from('match_events')
      .select('status, send_claimed_at, sent_target_ids')
      .eq('id', event.id)
      .eq('account_id', accountId)
      .maybeSingle();
    return {
      ok: false,
      code:
        (current && refusalFor(current as ClaimState, resend, now)) ||
        'SEND_IN_PROGRESS',
    };
  }

  const claimed = data as Pick<MatchEvent, 'status' | 'sent_target_ids'>;
  if (refusalFor({ ...claimed, send_claimed_at: null }, resend, now)) {
    await db
      .from('match_events')
      .update({ send_claimed_at: null })
      .eq('id', event.id)
      .eq('account_id', accountId)
      .eq('send_claimed_at', claimedAt);
    return { ok: false, code: 'ALREADY_SENT' };
  }

  return {
    ok: true,
    claimedAt,
    deliveredIds: [...(claimed.sent_target_ids ?? [])],
  };
}

export async function recordRadarSendProgress(
  db: SupabaseClient,
  accountId: string,
  eventId: string,
  claimedAt: string,
  deliveredIds: string[]
): Promise<boolean> {
  const { data, error } = await db
    .from('match_events')
    .update({ sent_target_ids: deliveredIds })
    .eq('id', eventId)
    .eq('account_id', accountId)
    .eq('send_claimed_at', claimedAt)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[radar/send] progress write failed:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function finishRadarSend(
  db: SupabaseClient,
  accountId: string,
  event: ClaimableEvent,
  claimedAt: string,
  deliveredIds: string[],
  sentNow: number
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from('match_events')
    .update(
      sentNow > 0
        ? {
            status: 'sent',
            sent_count: (event.sent_count || 0) + sentNow,
            sent_at: now,
            updated_at: now,
            sent_target_ids: deliveredIds,
            send_claimed_at: null,
          }
        : deliveredIds.length > 0
          ? {
              status: 'sent',
              sent_target_ids: deliveredIds,
              send_claimed_at: null,
            }
          : { send_claimed_at: null }
    )
    .eq('id', event.id)
    .eq('account_id', accountId)
    .eq('send_claimed_at', claimedAt);
  if (error) console.error('[radar/send] finish write failed:', error.message);
}
