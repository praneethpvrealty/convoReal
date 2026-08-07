// ============================================================
// Buyer match digest — delivery (server-only).
//
// The buyer twin of sendOwnerStatusDigests. For every account with a
// connected WhatsApp number, ranks each opted-in buyer's matches with
// the SAME engine the portal uses (matches-ranking.ts) and pushes the
// new ones to their chat.
//
// Three rules keep it from becoming spam:
//   1. Consent-first — 'declined' never hears from us, 'pending' is
//      asked exactly once (and only when their window is open, so no
//      unsolicited template lands), 'granted' gets the digest.
//   2. Insert-as-claim — the UNIQUE(account, buyer, day) ledger row is
//      taken BEFORE the send, so a re-run or a racing tick is a no-op.
//   3. No repeats — listings already sent in the last month are
//      filtered out, so an ignored match doesn't come back tomorrow.
//
// Best-effort throughout, like every other digest: one buyer's failure
// must never abort the run.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRANDING } from '@/config/branding';
// The session-first / template-fallback ladder is persona-neutral —
// reused rather than duplicated (it lives under den/ for historical
// reasons; the Den was the first surface that needed it).
import { isSessionOpen, sendDenNotification } from '@/lib/den/notify';
import {
  buildPropertyAlertParams,
  PROPERTY_ALERT_TEMPLATE_NAME,
} from '@/lib/whatsapp/property-alert-template';
import { curateForBuyer, hasBuyerBrief } from './matches-ranking';
import {
  buildConsentRequestMessage,
  buildMatchDigestMessage,
  MAX_DIGEST_MATCHES,
  REPEAT_SUPPRESSION_DAYS,
  selectUnsentMatches,
} from './digest';

/** Listings scored per account. Same cap as the portal feed. */
const POOL_PER_ACCOUNT = 300;
/** Buyers considered per account per run — a bound on both the work
 *  and the Meta send rate. Anything above this waits for tomorrow. */
const MAX_BUYERS_PER_ACCOUNT = 200;
/** Messages actually sent per account per run. */
const MAX_SENDS_PER_ACCOUNT = 50;

const BUYER_CLASSIFICATIONS = ['Buyer', 'Owner & Buyer'];

export interface AccountDigestSummary {
  accountId: string;
  buyers: number;
  sent: number;
  consentRequested: number;
  skippedNoMatches: number;
  skippedDeclined: number;
  skippedAwaitingConsent: number;
  skippedAlreadySent: number;
  skippedNoChannel: number;
  failed: number;
}

function portalUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(/\/$/, '');
  return `${base}/buyer/login?next=/buyer/matches`;
}

function istDateString(now: Date): string {
  // The ledger is keyed on the IST calendar day, matching the owner
  // digest — the whole product runs on Indian business hours.
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function alreadySentPropertyIds(
  db: SupabaseClient,
  contactId: string,
  now: Date
): Promise<Set<string>> {
  const since = new Date(now.getTime() - REPEAT_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000);
  const { data } = await db
    .from('buyer_match_digest_log')
    .select('property_ids')
    .eq('buyer_contact_id', contactId)
    .gte('digest_date', since.toISOString().slice(0, 10));
  const sent = new Set<string>();
  for (const row of data || []) {
    for (const id of (row.property_ids as string[] | null) || []) sent.add(id);
  }
  return sent;
}

async function runAccount(
  db: SupabaseClient,
  accountId: string,
  now: Date
): Promise<AccountDigestSummary> {
  const summary: AccountDigestSummary = {
    accountId,
    buyers: 0,
    sent: 0,
    consentRequested: 0,
    skippedNoMatches: 0,
    skippedDeclined: 0,
    skippedAwaitingConsent: 0,
    skippedAlreadySent: 0,
    skippedNoChannel: 0,
    failed: 0,
  };

  const { data: contactRows } = await db
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .eq('is_merged', false)
    .in('classification', BUYER_CLASSIFICATIONS)
    .not('phone', 'is', null)
    .limit(MAX_BUYERS_PER_ACCOUNT);

  const buyers = ((contactRows || []) as Contact[]).filter(hasBuyerBrief);
  summary.buyers = buyers.length;
  if (buyers.length === 0) return summary;

  // One pool read for the whole account — every buyer is scored
  // against the same inventory.
  const { data: poolRows } = await db
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .order('created_at', { ascending: false })
    .limit(POOL_PER_ACCOUNT);
  const pool = (poolRows || []) as Property[];
  if (pool.length === 0) return summary;

  const digestDate = istDateString(now);
  const url = portalUrl();
  const { data: accountRow } = await db
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  const agencyName = (accountRow?.name as string | undefined) ?? null;

  for (const buyer of buyers) {
    if (summary.sent + summary.consentRequested >= MAX_SENDS_PER_ACCOUNT) break;

    const consent = (buyer.buyer_alerts_consent as string | undefined) ?? 'pending';
    if (consent === 'declined') {
      summary.skippedDeclined++;
      continue;
    }

    try {
      const ranked = curateForBuyer(pool, buyer, { limit: MAX_DIGEST_MATCHES * 3 });
      if (ranked.length === 0) {
        summary.skippedNoMatches++;
        continue;
      }
      const sentIds = await alreadySentPropertyIds(db, buyer.id, now);
      const matches = selectUnsentMatches(ranked, sentIds);
      if (matches.length === 0) {
        summary.skippedNoMatches++;
        continue;
      }

      const sessionOpen = await isSessionOpen(db, accountId, buyer.id);

      // Consent-first, and free-form only. There is no template path:
      // soliciting an opt-in is MARKETING by Meta's test however it is
      // worded (a Utility submission of exactly this question came back
      // approved as Marketing), and a marketing template asking
      // permission to send marketing is the thing consent exists to
      // prevent. A closed window waits — src/lib/buyer/consent-ask.ts
      // asks the moment the buyer next messages us, which reaches far
      // more of them than this daily pass ever could.
      if (consent !== 'granted') {
        if (buyer.buyer_alerts_consent_requested_at) {
          summary.skippedAwaitingConsent++;
          continue;
        }
        if (!sessionOpen) {
          summary.skippedNoChannel++;
          continue;
        }
        const asked = await sendDenNotification(db, {
          accountId,
          contactId: buyer.id,
          text: buildConsentRequestMessage({
            contactName: buyer.name,
            matchCount: matches.length,
            agencyName,
          }),
        });
        if (!asked) {
          summary.failed++;
          continue;
        }
        await db
          .from('contacts')
          .update({ buyer_alerts_consent_requested_at: new Date().toISOString() })
          .eq('id', buyer.id)
          .eq('account_id', accountId);
        summary.consentRequested++;
        continue;
      }

      // Claim the day BEFORE sending: a racing tick loses with 23505
      // rather than double-messaging the buyer.
      const propertyIds = matches.map((m) => m.property.id);
      const { data: claim, error: claimErr } = await db
        .from('buyer_match_digest_log')
        .insert({
          account_id: accountId,
          buyer_contact_id: buyer.id,
          digest_date: digestDate,
          property_ids: propertyIds,
          channel: sessionOpen ? 'freeform' : 'template',
        })
        .select('id')
        .single();
      if (claimErr || !claim) {
        if (claimErr?.code === '23505') summary.skippedAlreadySent++;
        else summary.failed++;
        continue;
      }

      const top = matches[0].property;
      const delivered = await sendDenNotification(db, {
        accountId,
        contactId: buyer.id,
        text: buildMatchDigestMessage({
          contactName: buyer.name,
          matches,
          portalUrl: url,
        }),
        templateName: PROPERTY_ALERT_TEMPLATE_NAME,
        templateParams: buildPropertyAlertParams(buyer.name, top),
      });

      if (delivered) {
        summary.sent++;
      } else {
        // Release the claim so tomorrow's run can try again — an
        // unapproved template today may be approved by then.
        summary.skippedNoChannel++;
        await db.from('buyer_match_digest_log').delete().eq('id', claim.id);
      }
    } catch (err) {
      console.error('[buyer-match-digest] buyer failed:', buyer.id, err);
      summary.failed++;
    }
  }

  return summary;
}

/**
 * Run the digest pass for every account with a connected WhatsApp
 * number. Invoked by /api/cron/buyer-match-digest. Idempotent within
 * an IST day.
 */
export async function sendBuyerMatchDigests(options?: {
  db?: SupabaseClient;
  now?: Date;
  /** Restrict the run to one account (manual/test runs). */
  accountId?: string;
}): Promise<{ accounts: AccountDigestSummary[] }> {
  const db = options?.db || supabaseAdmin();
  const now = options?.now || new Date();

  let accountIds: string[];
  if (options?.accountId) {
    accountIds = [options.accountId];
  } else {
    const { data: configs } = await db
      .from('whatsapp_config')
      .select('account_id')
      .eq('status', 'connected');
    accountIds = [...new Set((configs || []).map((c) => c.account_id as string))];
  }

  const accounts: AccountDigestSummary[] = [];
  for (const accountId of accountIds) {
    try {
      accounts.push(await runAccount(db, accountId, now));
    } catch (err) {
      console.error('[buyer-match-digest] account failed:', accountId, err);
    }
  }
  return { accounts };
}
