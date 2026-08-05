// ============================================================
// Lead-sync reconciliation — the self-healing half of the email
// lead pipeline.
//
// The push path (Cloudflare Email Routing → Worker → POST
// /api/leads/email-webhook) is fast but fragile: when the worker's
// target URL breaks, mail is accepted at the edge and silently lost.
// The worker therefore keeps a KV ledger of every lead email it
// receives (docs/CLOUDFLARE_EMAIL_SETUP.md), and this module — run
// hourly from /api/cron/lead-sync-reconcile — pulls that ledger and
// closes the gap:
//
//   1. List undelivered ledger entries from the worker.
//   2. Entries the engine already logged (matched on ledger_id in
//      email_sync_logs) are only marked delivered on the worker —
//      never reprocessed, since reprocessing re-sends the auto-reply
//      to the lead.
//   3. Entries the engine never saw are re-ingested by PULLING the
//      raw MIME from the worker and invoking the webhook handler
//      in-process — no dependency on the push URL that just failed.
//   4. The account owner is told on WhatsApp when leads had to be
//      healed: healing works, but it means the push path is broken
//      and someone should fix the worker's ENGINE_BASE_URL.
//
// Limits: this can only see what the worker recorded. If the worker
// itself is unreachable or Email Routing no longer targets it, the
// cron reports worker_unreachable — visible in cron logs and the
// route response — but there is nothing to replay from.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

export interface LedgerEntry {
  id: string;
  accountId: string;
  from: string;
  subject: string;
  receivedAt: string;
  status: string;
}

export interface LedgerPlan {
  markOnly: LedgerEntry[];
  reingest: LedgerEntry[];
  deferred: LedgerEntry[];
}

// A push attempt that is still in flight must not be raced: entries
// younger than this are left for the next cycle.
export const PUSH_GRACE_MS = 10 * 60 * 1000;

export function planLedgerActions(
  entries: LedgerEntry[],
  knownLedgerIds: Set<string>,
  nowMs: number
): LedgerPlan {
  const plan: LedgerPlan = { markOnly: [], reingest: [], deferred: [] };
  for (const entry of entries) {
    if (knownLedgerIds.has(entry.id)) {
      plan.markOnly.push(entry);
      continue;
    }
    const receivedMs = Date.parse(entry.receivedAt);
    if (Number.isFinite(receivedMs) && nowMs - receivedMs < PUSH_GRACE_MS) {
      plan.deferred.push(entry);
      continue;
    }
    plan.reingest.push(entry);
  }
  return plan;
}

// 2xx: the lead is in. 429: the in-process rate limiter fired —
// transient, retry next cycle, like 5xx/network. Other <500: the
// engine looked and consciously refused (filtered, invalid phone,
// sync disabled) — mark delivered so the entry stops resurfacing.
// A 401 cannot occur here: re-ingestion passes the engine's own env
// token, which is exactly why this path heals token-mismatch outages.
export function reingestOutcome(status: number): 'healed' | 'rejected' | 'retry' {
  if (status >= 200 && status < 300) return 'healed';
  if (status === 429 || status >= 500) return 'retry';
  return 'rejected';
}

export interface ReconcileResult {
  status: 'ok' | 'disabled' | 'worker_unreachable';
  undelivered: number;
  markedDelivered: number;
  healed: number;
  rejected: number;
  retrying: number;
  deferred: number;
  errors: string[];
}

const CHUNK = 100;

async function knownIdsFor(ids: string[]): Promise<Set<string>> {
  const admin = supabaseAdmin();
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin
      .from('email_sync_logs')
      .select('ledger_id')
      .in('ledger_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(`email_sync_logs lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.ledger_id) known.add(row.ledger_id);
    }
  }
  return known;
}

async function notifyOwnersOfHealing(healedByAccount: Map<string, number>): Promise<void> {
  const admin = supabaseAdmin();
  for (const [accountId, count] of healedByAccount) {
    try {
      const { data: owner } = await admin
        .from('profiles')
        .select('user_id, phone')
        .eq('account_id', accountId)
        .eq('org_role', 'org_manager')
        .maybeSingle();
      if (!owner?.phone) continue;
      const noun = count === 1 ? 'lead was' : 'leads were';
      const result = await sendWhatsAppMessageAndPersist({
        accountId,
        userId: owner.user_id,
        toPhone: owner.phone,
        kind: 'text',
        senderType: 'bot',
        text:
          `⚠️ ConvoReal: ${count} portal ${noun} not delivered by the email forwarder and ` +
          `had to be recovered automatically. The contacts are now in your Engine, but the ` +
          `real-time path is failing — check the Cloudflare worker's ENGINE_BASE_URL variable.`,
      });
      if (!result.success) {
        console.warn(`[lead-reconcile] owner WhatsApp failed (non-fatal): ${result.error}`);
      }
    } catch (err) {
      console.error('[lead-reconcile] owner notification exception (non-fatal):', err);
    }
  }
}

export async function reconcileLeadLedger(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    status: 'ok',
    undelivered: 0,
    markedDelivered: 0,
    healed: 0,
    rejected: 0,
    retrying: 0,
    deferred: 0,
    errors: [],
  };

  const workerUrl = process.env.LEADS_WORKER_URL?.replace(/\/$/, '');
  const token = process.env.LEADS_WEBHOOK_TOKEN;
  if (!workerUrl || !token) {
    result.status = 'disabled';
    return result;
  }
  const auth = { authorization: `Bearer ${token}` };

  let entries: LedgerEntry[];
  try {
    const res = await fetch(`${workerUrl}/ledger`, { headers: auth });
    if (!res.ok) throw new Error(`ledger list returned ${res.status}`);
    entries = (await res.json()).entries ?? [];
  } catch (err) {
    console.error('[lead-reconcile] worker unreachable:', err);
    result.status = 'worker_unreachable';
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
  result.undelivered = entries.length;
  if (entries.length === 0) return result;

  const known = await knownIdsFor(entries.map((e) => e.id));
  const plan = planLedgerActions(entries, known, Date.now());
  result.deferred = plan.deferred.length;

  const markDelivered = async (id: string) => {
    const res = await fetch(`${workerUrl}/ledger/${encodeURIComponent(id)}/delivered`, {
      method: 'POST',
      headers: auth,
    });
    if (!res.ok) throw new Error(`mark-delivered ${id} returned ${res.status}`);
    result.markedDelivered++;
  };

  for (const entry of plan.markOnly) {
    try {
      await markDelivered(entry.id);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // The webhook handler is invoked in-process — a broken public URL is
  // exactly the failure being healed, so no self-fetch.
  const { POST: ingestLead } = await import('@/app/api/leads/email-webhook/route');
  const healedByAccount = new Map<string, number>();

  for (const entry of plan.reingest) {
    try {
      const rawRes = await fetch(`${workerUrl}/ledger/${encodeURIComponent(entry.id)}`, {
        headers: auth,
      });
      if (!rawRes.ok) throw new Error(`raw fetch ${entry.id} returned ${rawRes.status}`);
      const raw = await rawRes.text();

      const url = new URL('https://engine.internal/api/leads/email-webhook');
      url.searchParams.set('token', token);
      url.searchParams.set('account_id', entry.accountId);
      const res = await ingestLead(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subject: entry.subject,
            from: entry.from,
            text: raw,
            ledger_id: entry.id,
          }),
        })
      );

      const outcome = reingestOutcome(res.status);
      if (outcome === 'retry') {
        result.retrying++;
        result.errors.push(`reingest ${entry.id} returned ${res.status}`);
        continue;
      }
      if (outcome === 'healed') {
        result.healed++;
        healedByAccount.set(entry.accountId, (healedByAccount.get(entry.accountId) ?? 0) + 1);
      } else {
        result.rejected++;
      }
      await markDelivered(entry.id);
    } catch (err) {
      result.retrying++;
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  await notifyOwnersOfHealing(healedByAccount);
  return result;
}
