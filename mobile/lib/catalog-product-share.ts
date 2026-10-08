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

const CATALOG_SEND_TIMEOUT_MS = 60_000;
const CATALOG_SEND_BATCH = 5;
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
): Promise<{ sent: Contact[]; failed: { contact: Contact; error: string }[] }> {
  const reachable = contacts.filter(hasPhone);
  const unreachable = contacts
    .filter((c) => !hasPhone(c))
    .map((contact) => ({ contact, error: 'No phone number' }));
  const sent: Contact[] = [];
  const failed: { contact: Contact; error: string }[] = [...unreachable];
  for (let i = 0; i < reachable.length; i += CATALOG_SEND_BATCH) {
    const batch = reachable.slice(i, i + CATALOG_SEND_BATCH);
    let results: CatalogSendResult[] | undefined;
    try {
      const res = await apiFetch<{ results?: CatalogSendResult[] }>(
        '/api/whatsapp/broadcast',
        {
          method: 'POST',
          timeoutMs: CATALOG_SEND_TIMEOUT_MS,
          body: JSON.stringify({
            recipients: batch.map((c) => ({
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
      results = res?.results;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Send failed';
      failed.push(...batch.map((contact) => ({ contact, error })));
      continue;
    }
    const outcomes = matchCatalogSendResults(batch, results);
    const batchSent = outcomes.filter((o) => o.sent).map((o) => o.contact);
    for (const o of outcomes) {
      if (!o.sent) {
        failed.push({
          contact: o.contact,
          error: o.error ?? 'Delivery failure',
        });
      }
    }
    if (batchSent.length === 0) continue;
    sent.push(...batchSent);
    await apiFetch('/api/properties/share-log', {
      method: 'POST',
      body: JSON.stringify({
        property_id: property.id,
        recipients: batchSent.map((c) => ({ contact_id: c.id })),
        channel: 'whatsapp',
      }),
    }).catch(() => undefined);
  }
  return { sent, failed };
}
