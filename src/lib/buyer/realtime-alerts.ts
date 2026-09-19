import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import { getMatchingContacts, type MatchingResult } from '@/lib/matching';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { resolveQuietPeriod } from '@/lib/notifications/quiet-hours';
import { sendDenNotification } from '@/lib/den/notify';
import {
  PROPERTY_SHARE_TEMPLATE_NAMES,
  pickPropertyShareTemplate,
  propertyShareParams,
  shareHeaderImage,
} from '@/lib/whatsapp/property-share-template';
import {
  accountBrandImage,
  accountBrandName,
  accountPropertyShowcaseUrl,
} from '@/lib/showcase/account-showcase-url';
import { buildMatchDigestMessage } from '@/lib/buyer/digest';
import { matchReasons } from '@/lib/buyer/matches-ranking';
import { logListingsSent } from '@/lib/whatsapp/share-property-send';

const MIN_SCORE = 60;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60 * 60 * 1000;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const MAX_ALERTS_PER_PROPERTY = 200;

interface BuyerAlertDelivery {
  id: string;
  account_id: string;
  property_id: string;
  contact_id: string;
  attempt_count: number;
}

export interface BuyerAlertSummary {
  queued: number;
  delivered: number;
  deferred: number;
  cancelled: number;
  failed: number;
}

type RealtimeAlertContact = Contact & { is_merged?: boolean };

function canReceiveRealtimeAlert(contact: RealtimeAlertContact): boolean {
  return Boolean(
    contact.phone &&
    contact.status === 'active' &&
    contact.buyer_alerts_consent === 'granted' &&
    contact.requirement_active !== false &&
    !contact.is_dead &&
    !contact.is_archived &&
    !contact.is_merged
  );
}

export function realtimeAlertRetryAt(now: Date, attemptCount: number): Date {
  return new Date(now.getTime() + RETRY_DELAY_MS * Math.max(1, attemptCount));
}

export async function enqueueRealtimeBuyerAlerts(
  db: SupabaseClient,
  accountId: string,
  property: Property,
  matches: MatchingResult[],
  now: Date = new Date()
): Promise<number> {
  if (!property.is_published || property.status !== 'Available') return 0;

  const contactIds = [
    ...new Set(
      matches
        .filter((match) => canReceiveRealtimeAlert(match.contact))
        .map((match) => match.contact.id)
    ),
  ].slice(0, MAX_ALERTS_PER_PROPERTY);
  if (contactIds.length === 0) return 0;

  const [{ data: shared }, quiet] = await Promise.all([
    db
      .from('property_shares')
      .select('contact_id')
      .eq('account_id', accountId)
      .eq('property_id', property.id)
      .in('contact_id', contactIds),
    resolveQuietPeriod(accountId, 'client', now),
  ]);
  const sharedIds = new Set(
    ((shared ?? []) as { contact_id: string }[]).map((row) => row.contact_id)
  );
  const dueAt = quiet.isQuiet && quiet.deliverAt ? quiet.deliverAt : now;
  const rows = contactIds
    .filter((contactId) => !sharedIds.has(contactId))
    .map((contactId) => ({
      account_id: accountId,
      property_id: property.id,
      contact_id: contactId,
      due_at: dueAt.toISOString(),
    }));
  if (rows.length === 0) return 0;

  const { data, error } = await db
    .from('buyer_alert_deliveries')
    .upsert(rows, {
      onConflict: 'account_id,property_id,contact_id',
      ignoreDuplicates: true,
    })
    .select('id');
  if (error) {
    console.error('[buyer-alerts] queue insert failed:', error.message);
    return 0;
  }
  return data?.length ?? 0;
}

async function updateDelivery(
  db: SupabaseClient,
  row: BuyerAlertDelivery,
  update: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from('buyer_alert_deliveries')
    .update(update)
    .eq('id', row.id)
    .eq('account_id', row.account_id);
  if (error)
    console.error('[buyer-alerts] queue update failed:', error.message);
}

async function cancelDelivery(
  db: SupabaseClient,
  row: BuyerAlertDelivery,
  reason: string
): Promise<void> {
  await updateDelivery(db, row, {
    status: 'cancelled',
    claimed_at: null,
    last_error: reason,
  });
}

export async function deliverRealtimeBuyerAlerts(
  db: SupabaseClient,
  accountId: string,
  options: { propertyId?: string; now?: Date; limit?: number } = {}
): Promise<BuyerAlertSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const summary: BuyerAlertSummary = {
    queued: 0,
    delivered: 0,
    deferred: 0,
    cancelled: 0,
    failed: 0,
  };
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();

  let stale = db
    .from('buyer_alert_deliveries')
    .update({ status: 'pending', claimed_at: null })
    .eq('account_id', accountId)
    .eq('status', 'processing')
    .lt('claimed_at', staleBefore);
  if (options.propertyId) stale = stale.eq('property_id', options.propertyId);
  await stale;

  let due = db
    .from('buyer_alert_deliveries')
    .select('id, account_id, property_id, contact_id, attempt_count')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .lte('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(limit);
  if (options.propertyId) due = due.eq('property_id', options.propertyId);
  const { data: rows, error } = await due;
  if (error) {
    console.error('[buyer-alerts] queue fetch failed:', error.message);
    return summary;
  }
  summary.queued = rows?.length ?? 0;

  let brandName: string | null | undefined;
  let brandImage: string | null | undefined;

  for (const raw of rows ?? []) {
    const row = raw as BuyerAlertDelivery;
    const { data: claim } = await db
      .from('buyer_alert_deliveries')
      .update({ status: 'processing', claimed_at: now.toISOString() })
      .eq('id', row.id)
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claim) continue;

    const [{ data: property }, { data: contact }, { data: shared }] =
      await Promise.all([
        db
          .from('properties')
          .select('*')
          .eq('id', row.property_id)
          .eq('account_id', accountId)
          .maybeSingle(),
        db
          .from('contacts')
          .select('*, contact_notes(note_text)')
          .eq('id', row.contact_id)
          .eq('account_id', accountId)
          .maybeSingle(),
        db
          .from('property_shares')
          .select('id')
          .eq('account_id', accountId)
          .eq('property_id', row.property_id)
          .eq('contact_id', row.contact_id)
          .maybeSingle(),
      ]);

    if (shared) {
      await updateDelivery(db, row, {
        status: 'delivered',
        claimed_at: null,
        delivered_at: now.toISOString(),
        last_error: null,
      });
      summary.delivered++;
      continue;
    }

    const buyer = contact as RealtimeAlertContact | null;
    const listing = property as Property | null;
    if (
      !buyer ||
      !listing ||
      !canReceiveRealtimeAlert(buyer) ||
      !listing.is_published ||
      listing.status !== 'Available'
    ) {
      await cancelDelivery(db, row, 'No longer eligible');
      summary.cancelled++;
      continue;
    }

    const [hydrated] = await attachInquiredListingTypes(db, accountId, [buyer]);
    const match = getMatchingContacts(listing, [hydrated]).find(
      (candidate) => candidate.score >= MIN_SCORE
    );
    if (!match) {
      await cancelDelivery(db, row, 'No longer matches');
      summary.cancelled++;
      continue;
    }

    const quiet = await resolveQuietPeriod(accountId, 'client', now);
    if (quiet.isQuiet && quiet.deliverAt) {
      await updateDelivery(db, row, {
        status: 'pending',
        claimed_at: null,
        due_at: quiet.deliverAt.toISOString(),
        last_error: null,
      });
      summary.deferred++;
      continue;
    }

    if (brandName === undefined || brandImage === undefined) {
      [brandName, brandImage] = await Promise.all([
        accountBrandName(db, accountId),
        accountBrandImage(db, accountId),
      ]);
    }
    const portalUrl = await accountPropertyShowcaseUrl(
      db,
      accountId,
      listing,
      buyer.id
    );
    const headerImage = shareHeaderImage({
      images: listing.images,
      brandImage,
    });
    const text = buildMatchDigestMessage({
      contactName: buyer.name,
      matches: [
        {
          property: listing,
          score: match.score,
          details: match.details,
          reasons: matchReasons(match.details),
        },
      ],
      portalUrl,
    });
    const delivered = await sendDenNotification(db, {
      accountId,
      contactId: buyer.id,
      text,
      templateName: PROPERTY_SHARE_TEMPLATE_NAMES,
      pickTemplate: (templates) =>
        pickPropertyShareTemplate(templates, {
          hasImage: Boolean(headerImage),
        }),
      buildParams: (template) =>
        propertyShareParams(template.name, buyer.name, listing, brandName),
      buildButtonParams: (template) => {
        const buttonParams: Record<number, string> = {};
        (template.buttons ?? []).forEach((button, index) => {
          if (button.type === 'URL' && button.url.includes('{{1}}')) {
            buttonParams[index] = `?property_id=${listing.id}&v=${buyer.id}`;
          }
        });
        return buttonParams;
      },
      headerMediaUrl: headerImage,
    });

    if (delivered) {
      await logListingsSent(db, accountId, null, buyer.id, [listing.id]);
      await updateDelivery(db, row, {
        status: 'delivered',
        claimed_at: null,
        delivered_at: new Date().toISOString(),
        last_error: null,
      });
      summary.delivered++;
      continue;
    }

    // The central dispatcher records Meta 131049 on the contact. Keep this
    // alert queued until that cooldown ends instead of consuming retries every
    // hour. Utility templates can still deliver above; this branch is reached
    // only when the selected channel was unavailable or Marketing was capped.
    const { data: suppression } = await db
      .from('contacts')
      .select('whatsapp_marketing_suppressed_until')
      .eq('id', buyer.id)
      .eq('account_id', accountId)
      .maybeSingle();
    const suppressedUntil = suppression?.whatsapp_marketing_suppressed_until;
    if (
      suppressedUntil &&
      new Date(suppressedUntil).getTime() > now.getTime()
    ) {
      await updateDelivery(db, row, {
        status: 'pending',
        claimed_at: null,
        due_at: suppressedUntil,
        last_error: 'Deferred by WhatsApp marketing limit (131049)',
      });
      summary.deferred++;
      continue;
    }

    const attemptCount = row.attempt_count + 1;
    await updateDelivery(db, row, {
      status: attemptCount >= MAX_ATTEMPTS ? 'cancelled' : 'pending',
      attempt_count: attemptCount,
      claimed_at: null,
      due_at: realtimeAlertRetryAt(now, attemptCount).toISOString(),
      last_error: 'WhatsApp channel unavailable',
    });
    summary.failed++;
  }

  return summary;
}

export async function deliverRealtimeBuyerAlertsForConnectedAccounts(
  db: SupabaseClient,
  now: Date = new Date()
): Promise<BuyerAlertSummary> {
  const total: BuyerAlertSummary = {
    queued: 0,
    delivered: 0,
    deferred: 0,
    cancelled: 0,
    failed: 0,
  };
  const { data: configs, error } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('status', 'connected');
  if (error) {
    console.error('[buyer-alerts] account lookup failed:', error.message);
    return total;
  }

  const accountIds = [
    ...new Set((configs ?? []).map((config) => config.account_id as string)),
  ];
  for (const accountId of accountIds) {
    try {
      const result = await deliverRealtimeBuyerAlerts(db, accountId, { now });
      total.queued += result.queued;
      total.delivered += result.delivered;
      total.deferred += result.deferred;
      total.cancelled += result.cancelled;
      total.failed += result.failed;
    } catch (error) {
      total.failed++;
      console.error('[buyer-alerts] account delivery failed:', accountId, error);
    }
  }
  return total;
}
