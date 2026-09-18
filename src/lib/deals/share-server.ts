import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExternalDealSource } from './external-view';
import {
  hashClientIp,
  hashDealShareToken,
  isLinkLive,
  type DealShareLink,
} from './share-links';
import type { DealStakeholder } from './stakeholders';

/**
 * Service-role plumbing for the public deal-share routes. Everything
 * is scoped by the link the token resolves to — the link names the
 * account, the deal and the stakeholder, and nothing is read outside
 * that triangle. The payload itself is built only by
 * src/lib/deals/external-view.ts.
 */

export interface ResolvedShareLink {
  link: DealShareLink;
  stakeholder: DealStakeholder;
}

export async function resolveShareLink(
  admin: SupabaseClient,
  token: string
): Promise<
  | { state: 'missing' }
  | { state: 'dead'; link: DealShareLink }
  | ({ state: 'live' } & ResolvedShareLink)
> {
  if (!token || token.length < 20 || token.length > 128)
    return { state: 'missing' };

  const { data } = await admin
    .from('deal_share_links')
    .select('*, stakeholder:deal_stakeholders(*)')
    .eq('token_hash', hashDealShareToken(token))
    .maybeSingle();
  if (!data) return { state: 'missing' };

  const { stakeholder: rawStakeholder, ...link } = data as DealShareLink & {
    stakeholder: DealStakeholder | DealStakeholder[] | null;
  };
  const stakeholder = Array.isArray(rawStakeholder)
    ? (rawStakeholder[0] ?? null)
    : rawStakeholder;
  if (!isLinkLive(link) || !stakeholder) return { state: 'dead', link };
  return { state: 'live', link, stakeholder };
}

export type AccessEvent =
  | 'view'
  | 'denied'
  | 'otp_sent'
  | 'otp_verified'
  | 'otp_failed'
  | 'document_view'
  | 'document_denied';

export async function logShareAccess(
  admin: SupabaseClient,
  link: Pick<DealShareLink, 'id' | 'account_id' | 'deal_id'>,
  event: AccessEvent,
  request: Request,
  documentId: string | null = null
): Promise<void> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const { error } = await admin.from('deal_share_access_log').insert({
    account_id: link.account_id,
    link_id: link.id,
    deal_id: link.deal_id,
    event,
    document_id: documentId,
    ip_hash: hashClientIp(ip),
    user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300) || null,
  });
  if (error) console.error('[deal-share] access log failed:', error.message);
}

export async function trackShareView(
  admin: SupabaseClient,
  link: Pick<DealShareLink, 'id' | 'view_count'>
): Promise<void> {
  const { error } = await admin
    .from('deal_share_links')
    .update({
      view_count: (link.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', link.id);
  if (error) console.error('[deal-share] view tracking failed:', error.message);
}

const DEAL_SELECT =
  'id, title, status, deal_group_id, account_id, ' +
  'property:properties(title, unit_no), ' +
  'stakeholders:deal_stakeholders(id, side, contact_id, phone, email), ' +
  'milestones:deal_milestones(id, title, status, position, target_date, completed_at, visibility), ' +
  'events:deal_events(id, event_type, title, created_at, visibility), ' +
  'documents:deal_documents(id, title, category, status, expires_at, superseded_by, mime_type, visibility)';

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toSource(row: Record<string, unknown>): ExternalDealSource {
  const property = one(
    row.property as { title: string | null; unit_no: string | null } | null
  );
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    property_label: property?.unit_no
      ? `Property No. ${property.unit_no}`
      : (property?.title ?? null),
    deal_group_id: (row.deal_group_id as string | null) ?? null,
    stakeholders:
      (row.stakeholders as ExternalDealSource['stakeholders']) ?? [],
    milestones: (row.milestones as ExternalDealSource['milestones']) ?? [],
    events: (row.events as ExternalDealSource['events']) ?? [],
    documents: (row.documents as ExternalDealSource['documents']) ?? [],
  };
}

/** The deal behind a link plus its bundle siblings, all within the
 *  link's own account. The columns selected are exactly what the view
 *  builder needs; no financial column is ever read here. */
export async function loadShareSources(
  admin: SupabaseClient,
  link: Pick<DealShareLink, 'deal_id' | 'account_id'>
): Promise<{
  deal: ExternalDealSource;
  siblings: ExternalDealSource[];
} | null> {
  const { data: dealRow } = await admin
    .from('deals')
    .select(DEAL_SELECT)
    .eq('id', link.deal_id)
    .eq('account_id', link.account_id)
    .maybeSingle();
  if (!dealRow) return null;
  const deal = toSource(dealRow as unknown as Record<string, unknown>);

  let siblings: ExternalDealSource[] = [];
  if (deal.deal_group_id) {
    const { data: rows } = await admin
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', link.account_id)
      .eq('deal_group_id', deal.deal_group_id)
      .neq('id', deal.id)
      .limit(20);
    siblings = ((rows ?? []) as unknown as Record<string, unknown>[]).map(
      toSource
    );
  }
  return { deal, siblings };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  );
}

export function unlockFromRequest(request: Request): string | null {
  return (
    request.headers.get('x-deal-unlock') ||
    new URL(request.url).searchParams.get('unlock') ||
    null
  );
}
