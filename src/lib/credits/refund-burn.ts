import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { BillableFeatureKey } from './types';

const REFUND_ATTEMPTS = 3;
export const QUEUED_REFUND_ALERT_ATTEMPTS = 10;

export type RefundBurnResult =
  | { status: 'refunded'; refunded: number }
  | { status: 'queued' }
  | { status: 'failed' };

export function refundOutcomeNotice(result: RefundBurnResult): string {
  if (result.status === 'refunded') return 'Your credits were refunded.';
  if (result.status === 'queued') {
    return 'Your credits will be refunded within the hour.';
  }
  return 'We could not refund your credits automatically; please contact support.';
}

export function newBurnKey(feature: BillableFeatureKey): string {
  return `${feature}:${randomUUID()}`;
}

async function callRefundBurn(
  accountId: string,
  feature: string,
  burnKey: string
): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('refund_burn_tx', {
    p_account_id: accountId,
    p_feature: feature,
    p_burn_key: burnKey,
  });
  if (error) throw new Error(`[refundBurn] RPC failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return Number(row?.refunded ?? 0);
}

export async function refundBurn(
  accountId: string,
  feature: BillableFeatureKey,
  burnKey: string,
  opts: { reason?: string } = {}
): Promise<RefundBurnResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < REFUND_ATTEMPTS; attempt++) {
    try {
      return {
        status: 'refunded',
        refunded: await callRefundBurn(accountId, feature, burnKey),
      };
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
  }

  const { error } = await supabaseAdmin()
    .from('credit_refund_retries')
    .upsert(
      {
        account_id: accountId,
        feature,
        burn_key: burnKey,
        reason: opts.reason ?? null,
        last_error:
          lastError instanceof Error ? lastError.message : String(lastError),
      },
      { onConflict: 'account_id,burn_key' }
    );
  if (error) {
    console.error(
      `[refundBurn] ${feature} refund ${burnKey} for account ${accountId} was neither made nor queued; reconcile manually:`,
      error
    );
    return { status: 'failed' };
  }
  return { status: 'queued' };
}

export async function retryQueuedRefunds(
  limit = 50
): Promise<{ resolved: number; failed: number }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('credit_refund_retries')
    .select('id, account_id, feature, burn_key, attempts')
    .is('resolved_at', null)
    .order('attempts', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`[retryQueuedRefunds] ${error.message}`);

  let resolved = 0;
  let failed = 0;
  for (const row of data ?? []) {
    try {
      await callRefundBurn(row.account_id, row.feature, row.burn_key);
      await db
        .from('credit_refund_retries')
        .update({
          attempts: row.attempts + 1,
          last_error: null,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      resolved++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .from('credit_refund_retries')
        .update({ attempts: row.attempts + 1, last_error: message })
        .eq('id', row.id);
      if (row.attempts + 1 >= QUEUED_REFUND_ALERT_ATTEMPTS) {
        console.error(
          `[retryQueuedRefunds] ${row.feature} refund ${row.burn_key} for account ${row.account_id} has failed ${row.attempts + 1} times and is still retried; reconcile manually: ${message}`
        );
      }
      failed++;
    }
  }
  return { resolved, failed };
}
