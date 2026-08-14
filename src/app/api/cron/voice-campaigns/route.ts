import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isWithinCallWindow, STALE_CALLING_MS } from '@/lib/voice/campaigns';
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
const CALLS_PER_CAMPAIGN = 5;
const CALLS_PER_RUN = 25;

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
  let completedCampaigns = 0;

  try {
    const staleBefore = new Date(
      now.getTime() - STALE_CALLING_MS
    ).toISOString();
    const { data: requeuedRows } = await supabase
      .from('voice_campaign_recipients')
      .update({ status: 'queued' })
      .eq('status', 'calling')
      .lt('last_attempt_at', staleBefore)
      .select('id');
    requeued = requeuedRows?.length ?? 0;

    const { data: campaigns } = await supabase
      .from('voice_campaigns')
      .select(
        'id, account_id, sarvam_agent_id, script_context, call_window_start_hour, call_window_end_hour, max_attempts'
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
      if (!campaign.sarvam_agent_id) {
        console.warn(
          `[voice-campaigns] Campaign ${campaign.id} is active without a sarvam_agent_id — skipping.`
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

        const scriptContext =
          campaign.script_context && typeof campaign.script_context === 'object'
            ? (campaign.script_context as Record<string, string>)
            : {};
        const result = await startOutboundCall({
          agentId: campaign.sarvam_agent_id,
          phone: contact.phone,
          context: { contact_name: contact.name ?? '', ...scriptContext },
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

    const result = { requeued, started, failed, completedCampaigns };
    console.log('[voice-campaigns]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[voice-campaigns] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
