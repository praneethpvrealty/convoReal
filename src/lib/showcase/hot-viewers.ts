import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupConversation } from '@/lib/conversations/resolve';
import { createNotification } from '@/lib/notifications/create';

export const HOT_VIEWER_MIN_DWELL_MS = 120_000;
export const HOT_VIEWER_MIN_DAYS = 2;
export const HOT_VIEWER_SETTLE_MINUTES = 10;
export const HOT_VIEWER_FRESH_HOURS = 24;
export const HOT_VIEWER_LOOKBACK_DAYS = 7;
export const HOT_VIEWER_REALERT_DAYS = 7;
export const HOT_VIEWER_BATCH = 50;

export interface HotViewerCandidate {
  account_id: string;
  contact_id: string;
  property_id: string;
  dwell_ms: number;
  view_days: number;
  viewed_at: string;
}

export function formatDwell(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function buildHotViewerAlert(args: {
  contactName: string;
  contactPhone: string | null;
  propertyTitle: string;
  dwellMs: number;
  viewDays: number;
}): { title: string; body: string } {
  const signals = [`spent ${formatDwell(args.dwellMs)} on it`];
  if (args.viewDays >= 2) {
    signals.push(`came back on ${args.viewDays} different days`);
  }
  const who = args.contactPhone
    ? `${args.contactName} (${args.contactPhone})`
    : args.contactName;
  return {
    title: `🔥 Hot viewer: ${args.contactName}`,
    body: `${who} is looking hard at ${args.propertyTitle} on your showcase: ${signals.join(' and ')} this week. A call now, while it's fresh, is worth more than a message later.`,
  };
}

export async function processHotViewerAlerts(
  db: SupabaseClient
): Promise<number> {
  const { data, error } = await db.rpc('showcase_hot_viewer_candidates', {
    p_min_dwell_ms: HOT_VIEWER_MIN_DWELL_MS,
    p_min_days: HOT_VIEWER_MIN_DAYS,
    p_settle_minutes: HOT_VIEWER_SETTLE_MINUTES,
    p_fresh_hours: HOT_VIEWER_FRESH_HOURS,
    p_lookback_days: HOT_VIEWER_LOOKBACK_DAYS,
    p_realert_days: HOT_VIEWER_REALERT_DAYS,
    p_limit: HOT_VIEWER_BATCH,
  });
  if (error) {
    console.error('[hot-viewers] candidate query failed:', error);
    return 0;
  }

  let alerted = 0;
  for (const candidate of (data ?? []) as HotViewerCandidate[]) {
    const { data: alertId, error: claimError } = await db.rpc(
      'claim_showcase_hot_viewer_alert',
      {
        p_account_id: candidate.account_id,
        p_contact_id: candidate.contact_id,
        p_property_id: candidate.property_id,
        p_dwell_ms: candidate.dwell_ms,
        p_view_days: candidate.view_days,
        p_realert_days: HOT_VIEWER_REALERT_DAYS,
      }
    );
    if (claimError) {
      console.error('[hot-viewers] claim failed:', claimError);
      continue;
    }
    if (!alertId) continue;

    const [{ data: contact }, { data: property }, { data: config }] =
      await Promise.all([
        db
          .from('contacts')
          .select('name, phone, assigned_agent_id')
          .eq('id', candidate.contact_id)
          .eq('account_id', candidate.account_id)
          .maybeSingle(),
        db
          .from('properties')
          .select('title, user_id')
          .eq('id', candidate.property_id)
          .eq('account_id', candidate.account_id)
          .maybeSingle(),
        db
          .from('whatsapp_config')
          .select('user_id')
          .eq('account_id', candidate.account_id)
          .maybeSingle(),
      ]);
    const agentUserId =
      (contact?.assigned_agent_id as string | null) ??
      (property?.user_id as string | null) ??
      (config?.user_id as string | null) ??
      null;
    if (!contact || !property || !agentUserId) continue;

    const { conversation } = await lookupConversation<{ id: string }>(db, {
      accountId: candidate.account_id,
      contactId: candidate.contact_id,
      columns: 'id',
    });

    const alert = buildHotViewerAlert({
      contactName: (contact.name as string | null)?.trim() || 'A visitor',
      contactPhone: (contact.phone as string | null) ?? null,
      propertyTitle: (property.title as string | null) || 'a listing',
      dwellMs: candidate.dwell_ms,
      viewDays: candidate.view_days,
    });
    await createNotification({
      accountId: candidate.account_id,
      userId: agentUserId,
      type: 'listing_interest',
      eventKey: 'showcase_hot_viewer',
      title: alert.title,
      body: alert.body,
      entityType: conversation?.id ? 'conversation' : 'contact',
      entityId: conversation?.id ?? candidate.contact_id,
      link: conversation?.id
        ? `/inbox?conversation=${conversation.id}`
        : `/contacts?contactId=${candidate.contact_id}`,
      quietAudience: 'agent',
    });
    await db
      .from('showcase_hot_viewer_alerts')
      .update({ agent_user_id: agentUserId })
      .eq('id', alertId as string)
      .eq('account_id', candidate.account_id);
    alerted++;
  }
  return alerted;
}
