import {
  catalogProductCaption,
  catalogProductRetailerId,
  matchCatalogSendResults,
  type CatalogSendResult,
} from '@shared/lib/inventory/catalog-product-share';

import { apiFetch } from '@/lib/api';
import { hasPhone } from '@/lib/reachability';
import { supabase } from '@/lib/supabase';
import type { Contact, Property } from '@/lib/types';

export interface CatalogShareContext {
  catalogId: string | null;
  syncedAt: string | null;
  error: string | null;
  currency: string;
}

const CATALOG_SEND_BASE_TIMEOUT_MS = 30_000;
const CATALOG_SEND_PER_RECIPIENT_MS = 10_000;
const CATALOG_SEND_MAX_TIMEOUT_MS = 300_000;
const SHARE_LOG_ATTEMPTS = 3;
export const CATALOG_SEND_MAX_RECIPIENTS = 25;
const CATALOG_SYNC_TIMEOUT_MS = 60_000;

export async function fetchCatalogShareContext(
  accountId: string,
  propertyId: string
): Promise<CatalogShareContext> {
  const [config, row, showcase] = await Promise.all([
    supabase
      .from('whatsapp_config')
      .select('catalog_id')
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase
      .from('properties')
      .select('meta_catalog_synced_at, meta_catalog_error')
      .eq('id', propertyId)
      .maybeSingle(),
    supabase
      .from('showcase_settings')
      .select('currency')
      .eq('account_id', accountId)
      .maybeSingle(),
  ]);
  if (config.error) throw config.error;
  if (row.error) throw row.error;
  if (showcase.error) throw showcase.error;
  return {
    catalogId: config.data?.catalog_id ?? null,
    syncedAt: row.data?.meta_catalog_synced_at ?? null,
    error: row.data?.meta_catalog_error ?? null,
    currency: showcase.data?.currency || 'INR',
  };
}

export async function syncPropertyToCatalog(
  propertyId: string
): Promise<string> {
  const res = await apiFetch<{ synced_at?: string }>(
    `/api/properties/${propertyId}/sync-catalog`,
    { method: 'POST', timeoutMs: CATALOG_SYNC_TIMEOUT_MS }
  );
  return res?.synced_at ?? new Date().toISOString();
}

export async function sendCatalogProduct(
  catalogId: string,
  currency: string,
  property: Property,
  contacts: Contact[]
): Promise<{
  sent: Contact[];
  failed: { contact: Contact; error: string }[];
  unrecorded: boolean;
}> {
  const withPhone = contacts.filter(hasPhone);
  const reachable = withPhone.slice(0, CATALOG_SEND_MAX_RECIPIENTS);
  const unreachable = [
    ...contacts
      .filter((c) => !hasPhone(c))
      .map((contact) => ({ contact, error: 'No phone number' })),
    ...withPhone.slice(CATALOG_SEND_MAX_RECIPIENTS).map((contact) => ({
      contact,
      error: `Not sent: product cards go to at most ${CATALOG_SEND_MAX_RECIPIENTS} contacts at a time`,
    })),
  ];
  if (reachable.length === 0) {
    return { sent: [], failed: unreachable, unrecorded: false };
  }
  const res = await apiFetch<{ results?: CatalogSendResult[] }>(
    '/api/whatsapp/broadcast',
    {
      method: 'POST',
      timeoutMs: Math.min(
        CATALOG_SEND_MAX_TIMEOUT_MS,
        CATALOG_SEND_BASE_TIMEOUT_MS +
          reachable.length * CATALOG_SEND_PER_RECIPIENT_MS
      ),
      body: JSON.stringify({
        recipients: reachable.map((c) => ({
          phone: c.phone,
          contact_id: c.id,
        })),
        broadcast_type: 'product',
        product_catalog_id: catalogId,
        product_retailer_id: catalogProductRetailerId(property),
        content_text: catalogProductCaption(property, currency),
        property_id: property.id,
      }),
    }
  );
  const outcomes = matchCatalogSendResults(reachable, res?.results);
  const sent: Contact[] = outcomes.filter((o) => o.sent).map((o) => o.contact);
  const failed = [
    ...unreachable,
    ...outcomes
      .filter((o) => !o.sent)
      .map((o) => ({
        contact: o.contact as Contact,
        error: o.error ?? 'Delivery failure',
      })),
  ];
  const unrecorded =
    sent.length > 0 && !(await recordCatalogShares(property.id, sent));
  return { sent, failed, unrecorded };
}

async function recordCatalogShares(
  propertyId: string,
  contacts: Contact[]
): Promise<boolean> {
  let pending = contacts.map((c) => c.id);
  for (let attempt = 0; attempt < SHARE_LOG_ATTEMPTS; attempt++) {
    try {
      const res = await apiFetch<{ data?: { failed?: string[] } }>(
        '/api/properties/share-log',
        {
          method: 'POST',
          body: JSON.stringify({
            property_id: propertyId,
            recipients: pending.map((id) => ({ contact_id: id })),
            channel: 'whatsapp',
          }),
        }
      );
      pending = res?.data?.failed ?? [];
      if (pending.length === 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}
