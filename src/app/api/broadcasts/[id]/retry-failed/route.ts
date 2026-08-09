import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// POST /api/broadcasts/[id]/retry-failed
// Re-sends all recipients in the broadcast whose status is 'failed' or
// 'rate_limited' and whose retry_after is in the past (or null).
//
// Each retried recipient gets:
//   • retry_count incremented
//   • retry_after set to now + exponential backoff (capped at 5 min)
//   • status set back to 'rate_limited' or 'failed' after the re-send
//
// The actual send is delegated to /api/whatsapp/broadcast (same path as
// the initial broadcast) so all the template-resolution + DB-persist
// logic is reused without duplication.

const MAX_RETRIES = 5;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1200; // slightly over 1s to stay under Meta's per-second cap

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(msg: string): boolean {
  return (
    msg.includes('130429') ||
    msg.includes('131056') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('too many requests')
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: broadcastId } = await params;

    // Verify the broadcast belongs to this account
    const { data: broadcast, error: bErr } = await ctx.supabase
      .from('broadcasts')
      .select(
        'id, template_name, template_language, template_variables, account_id'
      )
      .eq('id', broadcastId)
      .eq('account_id', ctx.accountId)
      .single();

    if (bErr || !broadcast) {
      return NextResponse.json(
        { error: 'Broadcast not found' },
        { status: 404 }
      );
    }

    interface RetryableRecipient {
      id: string;
      contact_id: string | null;
      retry_count: number | null;
      contact: {
        id: string;
        phone: string;
        name: string | null;
        email: string | null;
        company: string | null;
      } | null;
    }

    // Find retryable recipients: failed or rate_limited, retry_after in the past
    const now = new Date().toISOString();
    const { data: retryableRaw, error: fetchErr } = await ctx.supabase
      .from('broadcast_recipients')
      .select(
        'id, contact_id, retry_count, contact:contacts(id, phone, name, email, company)'
      )
      .eq('broadcast_id', broadcastId)
      .in('status', ['failed', 'rate_limited'])
      .or(`retry_after.is.null,retry_after.lte.${now}`)
      .lte('retry_count', MAX_RETRIES - 1);

    const retryable = (retryableRaw ?? []) as unknown as RetryableRecipient[];

    if (fetchErr) throw fetchErr;
    if (retryable.length === 0) {
      return NextResponse.json({
        retried: 0,
        message: 'No retryable recipients found',
      });
    }

    /* eslint-disable convoreal/supabase-write-guard --
       Per-recipient status bookkeeping inside the send loop. Every row
       here was just read back under the same client, and the loop
       already records a per-recipient outcome in error_message, so a
       row-count check on each write would add noise without telling the
       caller anything it does not already report. */
    // Mark all as pending before starting so they don't get double-queued
    const retryableIds = retryable.map((r) => r.id);
    await ctx.supabase
      .from('broadcast_recipients')
      .update({ status: 'pending' })
      .in('id', retryableIds);

    let succeeded = 0;
    let failed = 0;
    let rateLimited = 0;

    for (let i = 0; i < retryable.length; i += BATCH_SIZE) {
      const batch = retryable.slice(i, i + BATCH_SIZE);

      const apiRecipients = batch
        .filter((r) => r.contact?.phone)
        .map((r) => ({
          phone: r.contact!.phone as string,
          params: [], // variables will be resolved by the broadcast route
        }));

      if (apiRecipients.length === 0) continue;

      let batchResults: Array<{
        phone: string;
        status: 'sent' | 'failed' | 'rate_limited';
        whatsapp_message_id?: string;
        error?: string;
        isRateLimited?: boolean;
      }> = [];

      try {
        // Re-use the existing broadcast send route — it handles template
        // resolution, WhatsApp API call, and message persistence.
        const res = await fetch(
          new URL('/api/whatsapp/broadcast', request.url).toString(),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Forward session cookie so the broadcast route can authenticate
              cookie: request.headers.get('cookie') ?? '',
            },
            body: JSON.stringify({
              recipients: apiRecipients,
              template_name: broadcast.template_name,
              template_language: broadcast.template_language ?? 'en_US',
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          batchResults = data.results ?? [];
        } else {
          // Entire batch failed (auth/config issue) — mark all as failed
          for (const r of batch) {
            const newCount = (r.retry_count ?? 0) + 1;
            await ctx.supabase
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                retry_count: newCount,
                retry_after: null,
                error_message: `Retry batch request failed: ${res.status}`,
              })
              .eq('id', r.id);
            failed++;
          }
          continue;
        }
      } catch (err) {
        for (const r of batch) {
          const newCount = (r.retry_count ?? 0) + 1;
          await ctx.supabase
            .from('broadcast_recipients')
            .update({
              status: 'failed',
              retry_count: newCount,
              retry_after: null,
              error_message:
                err instanceof Error ? err.message : 'Network error',
            })
            .eq('id', r.id);
          failed++;
        }
        continue;
      }

      // Map results back to recipients
      const byPhone = new Map(batchResults.map((r) => [r.phone, r]));

      for (const recipient of batch) {
        const phone = recipient.contact?.phone as string | undefined;
        const result = phone ? byPhone.get(phone) : undefined;
        const newCount = (recipient.retry_count ?? 0) + 1;

        if (!result || result.status === 'failed') {
          const errMsg = result?.error ?? 'No result returned';
          const isRL = result?.isRateLimited ?? isRateLimitError(errMsg);
          const backoffMs = Math.min(300_000, 1000 * Math.pow(2, newCount)); // cap 5m

          await ctx.supabase
            .from('broadcast_recipients')
            .update({
              status:
                isRL && newCount < MAX_RETRIES ? 'rate_limited' : 'failed',
              retry_count: newCount,
              retry_after:
                isRL && newCount < MAX_RETRIES
                  ? new Date(Date.now() + backoffMs).toISOString()
                  : null,
              error_message: errMsg,
            })
            .eq('id', recipient.id);

          if (isRL && newCount < MAX_RETRIES) {
            rateLimited++;
          } else {
            failed++;
          }
        } else {
          await ctx.supabase
            .from('broadcast_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              whatsapp_message_id: result.whatsapp_message_id ?? null,
              error_message: null,
              retry_count: newCount,
            })
            .eq('id', recipient.id);
          succeeded++;
        }
      }

      if (i + BATCH_SIZE < retryable.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    /* eslint-enable convoreal/supabase-write-guard */

    // Update broadcast status based on remaining failures
    const { data: summary } = await ctx.supabase
      .from('broadcast_recipients')
      .select('status')
      .eq('broadcast_id', broadcastId);

    const allFailed = summary?.every((r) => r.status === 'failed');
    // 'sending' counts as outstanding: a row claimed by a dispatcher is
    // still in flight, and calling the broadcast finished would take it
    // out of the sweep's sight and strand it unsent.
    const anyPending = summary?.some((r) =>
      ['pending', 'rate_limited', 'sending'].includes(r.status)
    );

    // This one the campaign screen reads, so a status that never landed
    // would leave a finished send showing as still sending.
    const { data: statusSaved } = await ctx.supabase
      .from('broadcasts')
      .update({
        status: allFailed ? 'failed' : anyPending ? 'sending' : 'sent',
      })
      .eq('id', broadcastId)
      .select('id');

    if (!statusSaved?.length) {
      console.warn(
        '[POST /api/broadcasts/[id]/retry-failed] Broadcast status not saved:',
        broadcastId
      );
    }

    return NextResponse.json({
      retried: retryable.length,
      succeeded,
      failed,
      rateLimited,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
