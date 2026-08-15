import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS, voiceCallCost } from '@/lib/credits/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isWithinCallWindow, STALE_CALLING_MS } from '@/lib/voice/campaigns';
import {
  getVoiceConfig,
  resolveDialCredentials,
  type VoiceAgentConfig,
} from '@/lib/voice/config';
import { decrypt } from '@/lib/whatsapp/encryption';
import { startOutboundCall } from '@/lib/voice/outbound-call';

/**
 * Voice campaign dispatcher (docs/voice-agent-integration-plan.md §6).
 * Each run: requeue stale 'calling' recipients whose result never came
 * back, then walk active campaigns inside their IST call window and
 * trigger a bounded batch of Sarvam outbound calls. Results arrive
 * through /api/webhooks/voice-agent (campaign_id in the payload),
 * which resolves the recipient's status — this route only starts
 * calls. Campaigns with nothing left in flight are marked completed.
 *
 * Registered in vercel.json (every 10 minutes). Safe to ping more
 * often: recipients move queued → calling atomically via a
 * status-guarded update, so a concurrent run cannot double-dial.
 *
 * Auth: same constant-time shared-secret check as the other crons.
 */

const CAMPAIGNS_PER_RUN = 20;
// Dials a tick may start, bounded by the provider's concurrent-channel
// allowance rather than by us: a call lasts minutes, so every dial this
// tick starts is still live when the next one goes out. Sarvam's
// pay-as-you-go plan allows 4 channels, and a dial past the cap is
// rejected — which costs an attempt and a refund, not a call. Raise
// VOICE_CALL_CHANNELS to match the plan when it changes.
const CALLS_PER_RUN = Math.max(1, Number(process.env.VOICE_CALL_CHANNELS) || 4);
const CALLS_PER_CAMPAIGN = Math.min(5, CALLS_PER_RUN);
/** Falls back to the platform-paid price for attempts charged before
 *  migration 279 recorded what each one cost. */
const FALLBACK_CALL_COST = AI_FEATURE_COSTS.voice_campaign_call;

export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const now = new Date();
  let requeued = 0;
  let started = 0;
  let failed = 0;
  let creditBlocked = 0;
  let completedCampaigns = 0;
  const configs = new Map<string, VoiceAgentConfig | null>();
  // Whose name the agent says it is calling on behalf of. Cached per
  // run like the config beside it, since one tick dials for at most a
  // handful of accounts.
  const brandNames = new Map<string, string>();

  try {
    // A stale 'calling' row means the call never happened or its result
    // was lost — the attempt's upfront charge is returned before the
    // row goes back in the queue.
    const staleBefore = new Date(
      now.getTime() - STALE_CALLING_MS
    ).toISOString();
    const { data: staleRows } = await supabase
      .from('voice_campaign_recipients')
      .select('id, account_id, charged_credits')
      .eq('status', 'calling')
      .lt('last_attempt_at', staleBefore)
      .limit(200);
    for (const stale of staleRows ?? []) {
      const { data: requeuedRow } = await supabase
        .from('voice_campaign_recipients')
        .update({ status: 'queued' })
        .eq('id', stale.id)
        .eq('status', 'calling')
        .select('id');
      if (!requeuedRow || requeuedRow.length === 0) continue;
      requeued++;
      await refundCredits(
        stale.account_id,
        'voice_campaign_call',
        stale.charged_credits ?? FALLBACK_CALL_COST,
        {
          description: `voice_campaign_call stale refund (recipient ${stale.id})`,
        }
      );
    }

    const { data: campaigns } = await supabase
      .from('voice_campaigns')
      .select(
        'id, account_id, agent_ref, script_context, call_window_start_hour, call_window_end_hour, max_attempts'
      )
      .eq('status', 'active')
      .limit(CAMPAIGNS_PER_RUN);

    for (const campaign of campaigns ?? []) {
      if (started >= CALLS_PER_RUN) break;
      if (
        !isWithinCallWindow(
          now,
          campaign.call_window_start_hour,
          campaign.call_window_end_hour
        )
      ) {
        continue;
      }
      // Which agent, whose credentials: the account's mode decides
      // (shared pool / own agent / own provider account). The
      // campaign's own agent_ref still wins over the account default
      // in the two modes that dial account-owned agents.
      if (!configs.has(campaign.account_id)) {
        configs.set(
          campaign.account_id,
          await getVoiceConfig(supabase, campaign.account_id)
        );
        const { data: account } = await supabase
          .from('accounts')
          .select('name')
          .eq('id', campaign.account_id)
          .maybeSingle();
        brandNames.set(campaign.account_id, account?.name || 'our team');
      }
      const credentials = resolveDialCredentials(
        configs.get(campaign.account_id) ?? null,
        campaign.agent_ref as string | null,
        decrypt
      );
      if (!credentials.ok) {
        console.warn(
          `[voice-campaigns] Campaign ${campaign.id} cannot dial: ${credentials.error} — skipping.`
        );
        continue;
      }

      const { data: recipients } = await supabase
        .from('voice_campaign_recipients')
        .select(
          'id, contact_id, attempts, contact:contacts(id, name, phone, do_not_call)'
        )
        .eq('account_id', campaign.account_id)
        .eq('campaign_id', campaign.id)
        .eq('status', 'queued')
        .lt('attempts', campaign.max_attempts)
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .limit(CALLS_PER_CAMPAIGN);

      for (const recipient of recipients ?? []) {
        if (started >= CALLS_PER_RUN) break;
        const contact = Array.isArray(recipient.contact)
          ? recipient.contact[0]
          : recipient.contact;
        if (!contact?.phone || contact.do_not_call) {
          await supabase
            .from('voice_campaign_recipients')
            .update({ status: contact?.do_not_call ? 'opted_out' : 'failed' })
            .eq('id', recipient.id)
            .eq('status', 'queued')
            .select('id');
          continue;
        }

        // Claim before dialing: a concurrent run's guarded update on the
        // same row matches zero rows and skips it.
        const { data: claimed } = await supabase
          .from('voice_campaign_recipients')
          .update({
            status: 'calling',
            attempts: recipient.attempts + 1,
            last_attempt_at: now.toISOString(),
          })
          .eq('id', recipient.id)
          .eq('status', 'queued')
          .select('id');
        if (!claimed || claimed.length === 0) continue;

        // Burn before the external call (credits-engine rule). The
        // retry key makes a crashed-and-rerun dispatch idempotent per
        // attempt. Unconnected attempts are refunded (stale requeue,
        // start failure below, no-answer/busy via the webhook).
        // byo accounts pay their own provider, so they are charged for
        // orchestration only. The amount is recorded on the attempt
        // below, because the refund paths that run elsewhere must
        // return exactly this, whatever the mode says later.
        const callCost = voiceCallCost(credentials.mode);
        const burn = await burnCredits(
          campaign.account_id,
          'voice_campaign_call',
          callCost,
          { retryKey: `voice-call:${recipient.id}:${recipient.attempts + 1}` }
        );
        if (!burn.success) {
          creditBlocked++;
          await supabase
            .from('voice_campaign_recipients')
            .update({ status: 'queued', attempts: recipient.attempts })
            .eq('id', recipient.id)
            .eq('status', 'calling')
            .select('id');
          console.warn(
            `[voice-campaigns] Insufficient credits (short ${burn.deficit}) for account ${campaign.account_id} — skipping campaign ${campaign.id}.`
          );
          break;
        }
        await supabase
          .from('voice_campaign_recipients')
          .update({ charged_credits: callCost })
          .eq('id', recipient.id)
          .select('id');

        const scriptContext =
          campaign.script_context && typeof campaign.script_context === 'object'
            ? (campaign.script_context as Record<string, string>)
            : {};
        const result = await startOutboundCall({
          agentId: credentials.agentId,
          apiKey: credentials.apiKey,
          provider: credentials.provider,
          phone: contact.phone,
          // campaign_id travels with the call so the agent can echo it
          // back in its post-call webhook: that is what resolves the
          // recipient row, so without it a connected call never leaves
          // 'calling' and gets redialled by the stale requeue.
          // account_id rides along for the same reason — the shared
          // pool's agent serves every account, so its webhook URL
          // cannot name one.
          context: {
            contact_name: contact.name ?? '',
            // The brokerage the call is on behalf of. A cold follow-up
            // that cannot name who is calling is worse than no call.
            brand_name: brandNames.get(campaign.account_id) ?? 'our team',
            campaign_id: campaign.id,
            account_id: campaign.account_id,
            ...scriptContext,
          },
        });

        if (result.ok) {
          started++;
        } else {
          failed++;
          console.error(
            `[voice-campaigns] Outbound call failed for recipient ${recipient.id}: ${result.error}`
          );
          const exhausted = recipient.attempts + 1 >= campaign.max_attempts;
          await supabase
            .from('voice_campaign_recipients')
            .update({ status: exhausted ? 'failed' : 'queued' })
            .eq('id', recipient.id)
            .eq('status', 'calling')
            .select('id');
          await refundCredits(
            campaign.account_id,
            'voice_campaign_call',
            callCost,
            {
              description: `voice_campaign_call start-failure refund (recipient ${recipient.id})`,
            }
          );
        }
      }

      const { count: remaining } = await supabase
        .from('voice_campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id)
        .in('status', ['queued', 'calling']);
      if (remaining === 0) {
        const { data: done } = await supabase
          .from('voice_campaigns')
          .update({ status: 'completed' })
          .eq('id', campaign.id)
          .eq('status', 'active')
          .select('id');
        completedCampaigns += done?.length ?? 0;
      }
    }

    const result = {
      requeued,
      started,
      failed,
      creditBlocked,
      completedCampaigns,
    };
    console.log('[voice-campaigns]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[voice-campaigns] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
