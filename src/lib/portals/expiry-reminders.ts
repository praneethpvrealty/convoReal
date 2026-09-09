import { supabaseAdmin } from '@/lib/automations/admin-client';
import { createNotification } from '@/lib/notifications/create';
import { PORTALS, type PortalKey } from '@/lib/portals/post-kit';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_REMINDER_DAYS = [7, 3, 1] as const;
const MISSING_EXPIRY_INTERVAL_DAYS = 7;
const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

export type PortalExpiryReminderKind =
  | 'missing_expiry'
  | 'upcoming'
  | 'expiry_day'
  | 'overdue';

export interface PortalExpiryReminderSchedule {
  key: string;
  kind: PortalExpiryReminderKind;
  dueOn: string;
  daysUntilExpiry: number | null;
  daysOverdue: number | null;
}

interface PortalListingRow {
  id: string;
  account_id: string;
  user_id: string | null;
  portal: string;
  listing_url: string | null;
  posted_at: string;
  expires_on: string | null;
  property: {
    id: string;
    title: string | null;
    property_code: string | null;
  } | null;
}

interface DuePortalReminder {
  listing: PortalListingRow;
  recipientUserId: string;
  schedule: PortalExpiryReminderSchedule;
}

interface ClaimedPortalReminder extends DuePortalReminder {
  logId: string;
}

function dateKeyInIndia(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dayNumber(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / DAY_MS);
}

function addDays(dateKey: string, days: number): string {
  return new Date((dayNumber(dateKey) + days) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function listingDateKey(postedAt: string): string | null {
  const date = new Date(postedAt);
  return Number.isNaN(date.getTime()) ? null : dateKeyInIndia(date);
}

export function portalExpiryReminderSchedule(
  input: { postedAt: string; expiresOn: string | null },
  now: Date = new Date()
): PortalExpiryReminderSchedule | null {
  const today = dateKeyInIndia(now);

  if (!input.expiresOn) {
    const postedOn = listingDateKey(input.postedAt);
    if (!postedOn) return null;
    const ageDays = dayNumber(today) - dayNumber(postedOn);
    if (ageDays < MISSING_EXPIRY_INTERVAL_DAYS) return null;
    const interval = Math.floor(ageDays / MISSING_EXPIRY_INTERVAL_DAYS);
    const dueOn = addDays(postedOn, interval * MISSING_EXPIRY_INTERVAL_DAYS);
    return {
      key: `missing-expiry:${dueOn}`,
      kind: 'missing_expiry',
      dueOn,
      daysUntilExpiry: null,
      daysOverdue: null,
    };
  }

  const daysUntilExpiry = dayNumber(input.expiresOn) - dayNumber(today);
  if (daysUntilExpiry > UPCOMING_REMINDER_DAYS[0]) return null;

  if (daysUntilExpiry > UPCOMING_REMINDER_DAYS[1]) {
    return {
      key: `expiry:${input.expiresOn}:before-7`,
      kind: 'upcoming',
      dueOn: addDays(input.expiresOn, -7),
      daysUntilExpiry,
      daysOverdue: null,
    };
  }
  if (daysUntilExpiry > UPCOMING_REMINDER_DAYS[2]) {
    return {
      key: `expiry:${input.expiresOn}:before-3`,
      kind: 'upcoming',
      dueOn: addDays(input.expiresOn, -3),
      daysUntilExpiry,
      daysOverdue: null,
    };
  }
  if (daysUntilExpiry === 1) {
    return {
      key: `expiry:${input.expiresOn}:before-1`,
      kind: 'upcoming',
      dueOn: addDays(input.expiresOn, -1),
      daysUntilExpiry,
      daysOverdue: null,
    };
  }
  if (daysUntilExpiry === 0) {
    return {
      key: `expiry:${input.expiresOn}:expiry-day`,
      kind: 'expiry_day',
      dueOn: input.expiresOn,
      daysUntilExpiry,
      daysOverdue: 0,
    };
  }

  const daysOverdue = Math.abs(daysUntilExpiry);
  const interval = Math.floor(daysOverdue / OVERDUE_REMINDER_INTERVAL_DAYS);
  const dueOn = addDays(
    input.expiresOn,
    interval * OVERDUE_REMINDER_INTERVAL_DAYS
  );
  return {
    key:
      interval === 0
        ? `expiry:${input.expiresOn}:expiry-day`
        : `expiry:${input.expiresOn}:overdue-${interval}`,
    kind: 'overdue',
    dueOn,
    daysUntilExpiry,
    daysOverdue,
  };
}

function formatExpiryDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function propertyLabel(listing: PortalListingRow): string {
  const code = listing.property?.property_code?.trim();
  const title = listing.property?.title?.trim() || 'Property';
  return code ? `${code} — ${title}` : title;
}

function reminderLine(reminder: DuePortalReminder): string {
  const label = propertyLabel(reminder.listing);
  const schedule = reminder.schedule;
  if (schedule.kind === 'missing_expiry') {
    return `${label} — expiry date missing`;
  }
  const expiry = formatExpiryDate(reminder.listing.expires_on as string);
  if (schedule.kind === 'expiry_day')
    return `${label} — expires today (${expiry})`;
  if (schedule.kind === 'overdue') {
    return `${label} — expired ${expiry} (${schedule.daysOverdue} day${schedule.daysOverdue === 1 ? '' : 's'} ago)`;
  }
  return `${label} — expires ${expiry} (${schedule.daysUntilExpiry} day${schedule.daysUntilExpiry === 1 ? '' : 's'} left)`;
}

export function buildPortalExpiryReminderCopy(
  portal: string,
  reminders: DuePortalReminder[]
): { title: string; body: string } {
  const portalLabel = PORTALS[portal as PortalKey]?.label || portal;
  const allMissing = reminders.every(
    (reminder) => reminder.schedule.kind === 'missing_expiry'
  );
  const title = allMissing
    ? `${portalLabel}: ${reminders.length} expiry date${reminders.length === 1 ? '' : 's'} missing`
    : `${portalLabel}: ${reminders.length} listing${reminders.length === 1 ? '' : 's'} need attention`;
  const visible = reminders.slice(0, 10).map(reminderLine);
  const remaining = reminders.length - visible.length;
  const action = allMissing
    ? 'Add each expiry date in Inventory → Post to Portals. ConvoReal will then remind you 7, 3 and 1 days before, on expiry day, and weekly after expiry until you renew or remove it.'
    : 'Renew the listing on the portal and update its expiry date, or mark it removed in Inventory → Post to Portals.';
  return {
    title,
    body: [
      ...visible.map((line) => `• ${line}`),
      remaining > 0 ? `• and ${remaining} more` : null,
      '',
      action,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
  };
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://www.convoreal.com'
  ).replace(/\/$/, '');
}

async function ownerByAccount(
  accountIds: string[]
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  if (accountIds.length === 0) return owners;
  const { data } = await supabaseAdmin()
    .from('profiles')
    .select('account_id, user_id')
    .in('account_id', accountIds)
    .eq('account_role', 'owner');
  for (const row of data || []) {
    if (!owners.has(row.account_id)) owners.set(row.account_id, row.user_id);
  }
  return owners;
}

async function claimReminder(
  reminder: DuePortalReminder,
  now: Date
): Promise<ClaimedPortalReminder | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('portal_listing_expiry_reminder_log')
    .insert({
      account_id: reminder.listing.account_id,
      listing_id: reminder.listing.id,
      user_id: reminder.recipientUserId,
      reminder_key: reminder.schedule.key,
      reminder_kind: reminder.schedule.kind,
      due_on: reminder.schedule.dueOn,
      attempted_at: now.toISOString(),
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code !== '23505') {
      console.error('[Portal Expiry] reminder claim failed:', error);
    }
    return null;
  }
  return data ? { ...reminder, logId: data.id as string } : null;
}

export async function sendPortalExpiryReminders(
  now: Date = new Date()
): Promise<number> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('property_portal_listings')
    .select(
      'id, account_id, user_id, portal, listing_url, posted_at, expires_on, property:properties(id, title, property_code)'
    )
    .eq('status', 'active')
    .order('posted_at', { ascending: true })
    .limit(500);

  if (error) {
    console.error('[Portal Expiry] fetch failed:', error);
    return 0;
  }

  const listings = (data || []) as unknown as PortalListingRow[];
  const ownerFallbacks = await ownerByAccount([
    ...new Set(
      listings
        .filter((listing) => !listing.user_id)
        .map((listing) => listing.account_id)
    ),
  ]);
  const due: DuePortalReminder[] = [];
  for (const listing of listings) {
    const schedule = portalExpiryReminderSchedule(
      { postedAt: listing.posted_at, expiresOn: listing.expires_on },
      now
    );
    const recipientUserId =
      listing.user_id || ownerFallbacks.get(listing.account_id);
    if (!schedule || !recipientUserId) continue;
    due.push({ listing, recipientUserId, schedule });
  }

  const claimed = (
    await Promise.all(due.map((reminder) => claimReminder(reminder, now)))
  ).filter((reminder): reminder is ClaimedPortalReminder => !!reminder);
  const groups = new Map<string, ClaimedPortalReminder[]>();
  for (const reminder of claimed) {
    const key = `${reminder.listing.account_id}:${reminder.recipientUserId}:${reminder.listing.portal}`;
    groups.set(key, [...(groups.get(key) || []), reminder]);
  }

  let processed = 0;
  for (const reminders of groups.values()) {
    const first = reminders[0];
    const copy = buildPortalExpiryReminderCopy(first.listing.portal, reminders);
    const singlePropertyId =
      reminders.length === 1 ? first.listing.property?.id : null;
    const link = singlePropertyId
      ? `/inventory?portalPropertyId=${singlePropertyId}`
      : '/inventory';
    try {
      const result = await createNotification({
        accountId: first.listing.account_id,
        userId: first.recipientUserId,
        type: 'portal_listing_expiry',
        eventKey: 'portal_listing_expiry',
        title: copy.title,
        body: copy.body,
        entityType: singlePropertyId ? 'property' : null,
        entityId: singlePropertyId,
        link,
        whatsappText: `⏳ *${copy.title}*\n\n${copy.body}\n\n${siteUrl()}${link}`,
        quietAudience: 'agent',
      });
      const { error: completeError } = await admin
        .from('portal_listing_expiry_reminder_log')
        .update({
          completed_at: new Date().toISOString(),
          delivery_result: {
            in_app_id: result.inAppId,
            whatsapp_sent: result.whatsapp?.success ?? false,
            push_count: result.pushCount,
          },
        })
        .in(
          'id',
          reminders.map((reminder) => reminder.logId)
        );
      if (completeError) {
        console.error('[Portal Expiry] completion log failed:', completeError);
      }
      processed += reminders.length;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      await admin
        .from('portal_listing_expiry_reminder_log')
        .update({ failed_at: new Date().toISOString(), error_message: message })
        .in(
          'id',
          reminders.map((reminder) => reminder.logId)
        );
      console.error('[Portal Expiry] notification failed:', reason);
    }
  }

  return processed;
}
