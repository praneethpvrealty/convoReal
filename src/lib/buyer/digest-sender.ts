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
import {
  collapseToParties,
  loadContactParties,
} from '@/lib/contacts/parties';
import { BRANDING } from '@/config/branding';
// The session-first / template-fallback ladder is persona-neutral —
// reused rather than duplicated (it lives under den/ for historical
// reasons; the Den was the first surface that needed it).
import { SESSION_WINDOW_MS, sendDenNotification } from '@/lib/den/notify';
import {
  PROPERTY_SHARE_TEMPLATE_NAMES,
  pickPropertyShareTemplate,
  propertyShareParams,
  shareHeaderImage,
} from '@/lib/whatsapp/property-share-template';
import {
  accountBrandImage,
  accountBrandName,
} from '@/lib/showcase/account-showcase-url';
import { curateForBuyer, hasBuyerBrief } from './matches-ranking';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { logListingsSent } from '@/lib/whatsapp/share-property-send';
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

// Everyone who might be on the buying side of a listing. Buyers and
// owner-buyers are obvious; agents buy and place property for their own
// clients; developers acquire — land parcels above all, which is a real
// part of this inventory. This list is wider than Radar's
// isRadarContactClassification on purpose: Radar suggests contacts to an
// agent for a property, where a developer among the names is noise,
// while every send from here was asked for by the contact themselves
// (consent is checked below) and answers their own stated brief.
const BUYER_CLASSIFICATIONS = [
  'Buyer',
  'Owner & Buyer',
  'Agent',
  'Developer',
];

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

// Both prefetches below replace what used to be two per-buyer round
// trips (already-sent lookup, session-open check) with one bulk query
// each for the whole account. A 100+ buyer account was previously
// paying 100+ sequential queries just to find out who to skip.

async function bulkAlreadySentPropertyIds(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[],
  now: Date
): Promise<Map<string, Set<string>>> {
  const byContact = new Map<string, Set<string>>();
  if (contactIds.length === 0) return byContact;
  const since = new Date(now.getTime() - REPEAT_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000);
  const { data } = await db
    .from('buyer_match_digest_log')
    .select('buyer_contact_id, property_ids')
    .eq('account_id', accountId)
    .in('buyer_contact_id', contactIds)
    .gte('digest_date', since.toISOString().slice(0, 10));
  for (const row of data || []) {
    const contactId = row.buyer_contact_id as string;
    const sent = byContact.get(contactId) ?? new Set<string>();
    for (const id of (row.property_ids as string[] | null) || []) sent.add(id);
    byContact.set(contactId, sent);
  }

  // The digest log only knows what the digest itself sent. A listing an
  // agent shared by hand, or the chat funnel put in front of them, is
  // just as sent — and arriving as "here's one that fits" weeks later
  // reads as nobody having kept track. The share ledger is the record
  // every surface writes to, so it decides this too, with no time
  // limit: a listing is offered to a contact once.
  const { data: shareRows } = await db
    .from('property_shares')
    .select('contact_id, property_id')
    .eq('account_id', accountId)
    .in('contact_id', contactIds);
  for (const row of shareRows || []) {
    const contactId = row.contact_id as string;
    const sent = byContact.get(contactId) ?? new Set<string>();
    sent.add(row.property_id as string);
    byContact.set(contactId, sent);
  }
  return byContact;
}

async function bulkSessionOpen(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[]
): Promise<Map<string, boolean>> {
  const openByContact = new Map<string, boolean>();
  if (contactIds.length === 0) return openByContact;
  const { data: convRows } = await db
    .from('conversations')
    .select('id, contact_id')
    .eq('account_id', accountId)
    .in('contact_id', contactIds);
  const convIdByContact = new Map<string, string>();
  for (const row of convRows || []) {
    convIdByContact.set(row.contact_id as string, row.id as string);
  }
  const convIds = [...convIdByContact.values()];
  if (convIds.length === 0) return openByContact;

  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
  const { data: msgRows } = await db
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', convIds)
    .eq('sender_type', 'customer')
    .gte('created_at', since);
  const openConvIds = new Set((msgRows || []).map((row) => row.conversation_id as string));
  for (const [contactId, convId] of convIdByContact) {
    openByContact.set(contactId, openConvIds.has(convId));
  }
  return openByContact;
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

  // A couple sharing one requirement is one buyer to digest. Both would
  // otherwise receive the same listings on the same morning, and each
  // send is a template message the account pays for.
  const parties = await loadContactParties(db, accountId);
  const buyers = await attachInquiredListingTypes(
    db,
    accountId,
    collapseToParties(
      ((contactRows || []) as Contact[]).filter(hasBuyerBrief),
      (c) => c.id,
      parties
    ).map(({ row }) => row)
  );
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

  const consideredIds = buyers
    .filter((b) => ((b.buyer_alerts_consent as string | undefined) ?? 'pending') !== 'declined')
    .map((b) => b.id);
  const [sentIdsByBuyer, sessionOpenByBuyer] = await Promise.all([
    bulkAlreadySentPropertyIds(db, accountId, consideredIds, now),
    bulkSessionOpen(db, accountId, consideredIds),
  ]);

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
      const sentIds = sentIdsByBuyer.get(buyer.id) ?? new Set<string>();
      const matches = selectUnsentMatches(ranked, sentIds);
      if (matches.length === 0) {
        summary.skippedNoMatches++;
        continue;
      }

      const sessionOpen = sessionOpenByBuyer.get(buyer.id) ?? false;

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
      // The digest is headlined by its top match, so that listing's own
      // photo leads the card — the account's brand image when it has
      // none. A digest that arrives as a block of text is a worse
      // digest, and the header costs nothing at the category level.
      const [brandImage, brandName] = await Promise.all([
        accountBrandImage(db, accountId),
        accountBrandName(db, accountId),
      ]);
      const headerImage = shareHeaderImage({ images: top.images, brandImage });
      const delivered = await sendDenNotification(db, {
        accountId,
        contactId: buyer.id,
        text: buildMatchDigestMessage({
          contactName: buyer.name,
          matches,
          portalUrl: url,
        }),
        templateName: PROPERTY_SHARE_TEMPLATE_NAMES,
        pickTemplate: (rows) =>
          pickPropertyShareTemplate(rows, { hasImage: Boolean(headerImage) }),
        // The params must match whichever name pickTemplate lands on,
        // so they are built from it rather than assumed.
        buildParams: (template) =>
          propertyShareParams(template.name, buyer.name, top, brandName),
        // The URL button carries the listing so a tap opens straight to
        // it — same v= attribution as every other property-share send.
        buildButtonParams: (template) => {
          const buttonParams: Record<number, string> = {};
          (template.buttons ?? []).forEach((btn, idx) => {
            if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
              buttonParams[idx] = `?property_id=${top.id}&v=${buyer.id}`;
            }
          });
          return buttonParams;
        },
        headerMediaUrl: headerImage,
      });

      if (delivered) {
        summary.sent++;
        // Into the ledger every other surface reads, so the funnel and
        // the next agent share both know these have gone out.
        await logListingsSent(db, accountId, null, buyer.id, propertyIds);
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
