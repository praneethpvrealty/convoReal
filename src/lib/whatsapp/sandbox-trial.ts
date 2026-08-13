// ============================================================
// What happens to a sandbox sender after the trial ends.
//
// The shared sandbox number routes by sender: the first message
// carrying "#code" writes a row in sandbox_sender_mappings, and every
// later message from that number resolves through it. The row is
// written once and has no expiry — but the trial behind it does.
//
// So a lapsed tenant's mappings outlived their service, and the webhook
// answered every message resolving through one with a bare `continue`.
// No reply, no message row, no trace on either side. A number that had
// tried the sandbox in June could not reach the brokerage that actually
// owns the shared number, and neither party could tell: the sender saw
// silence, and the database looked like the message had never been
// sent. One real number sat in that state for five weeks and was only
// found by reading the ingress logs.
//
// Releasing the mapping is what makes the drop self-healing. An
// unmapped sender already falls through to whichever Official API
// account owns the number, so letting go of the dead row puts this
// message — and every later one — back on a path that answers.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SandboxTenantConfig {
  trial_ends_at?: string | null;
  sandbox_message_count?: number | null;
  sandbox_message_limit?: number | null;
}

/**
 * True when the tenant's sandbox trial has run out.
 *
 * No `trial_ends_at` means no trial clock — a sandbox config that was
 * never given an end date is open-ended, not expired, and must keep
 * routing exactly as it does today. An unparseable date is treated the
 * same way: a bad value is a reason to leave the tenant alone, not to
 * cut off their prospects.
 */
export function isSandboxTrialExpired(
  config: SandboxTenantConfig | null | undefined,
  now: Date = new Date()
): boolean {
  const endsAt = config?.trial_ends_at;
  if (!endsAt) return false;
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(ends)) return false;
  return now.getTime() > ends;
}

/**
 * Drops the sender's mapping to a tenant that can no longer serve them.
 *
 * Deleted rather than flagged: the mapping's only reader resolves a
 * sender to an account, and the absence of a row is already a state
 * that path handles — it is what every sender who never used a hashtag
 * looks like. A sender who later messages a live tenant's "#code"
 * simply gets a fresh mapping.
 *
 * Never throws. This runs inside webhook processing, where failing to
 * tidy up matters far less than the message that follows.
 */
export async function releaseSandboxSender(
  db: SupabaseClient,
  senderPhone: string
): Promise<boolean> {
  try {
    const { error } = await db
      .from('sandbox_sender_mappings')
      .delete()
      .eq('sender_phone', senderPhone);
    if (error) {
      console.error(
        '[sandbox-trial] failed to release mapping (non-fatal):',
        error
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      '[sandbox-trial] failed to release mapping (non-fatal):',
      err
    );
    return false;
  }
}
