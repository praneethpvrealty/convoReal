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

const CATALOG_SEND_TIMEOUT_MS = 120_000;

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
    { method: 'POST' }
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
  if (reachable.length === 0) return { sent: [], failed: unreachable };
  const res = await apiFetch<{ results?: CatalogSendResult[] }>(
    '/api/whatsapp/broadcast',
    {
      method: 'POST',
      timeoutMs: CATALOG_SEND_TIMEOUT_MS,
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
  const sent = outcomes.filter((o) => o.sent).map((o) => o.contact);
  const failed = [
    ...unreachable,
    ...outcomes
      .filter((o) => !o.sent)
      .map((o) => ({
        contact: o.contact as Contact,
        error: o.error ?? 'Delivery failure',
      })),
  ];
  if (sent.length > 0) {
    await apiFetch('/api/properties/share-log', {
      method: 'POST',
      body: JSON.stringify({
        property_id: property.id,
        recipients: sent.map((c) => ({
          contact_id: c.id,
          classification: c.classification ?? null,
        })),
        channel: 'whatsapp',
      }),
    }).catch(() => undefined);
  }
  return { sent, failed };
}
