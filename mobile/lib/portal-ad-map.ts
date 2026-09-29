import { apiFetch, isTimeout } from './api';
import { supabase } from './supabase';

export interface PortalAdMapResult {
  propertyTitle: string;
  taggedContacts: number | null;
}

export interface PortalAdRef {
  portal: string;
  portalListingId: string;
}

export const PORTAL_LINK_TIMEOUT_MS = 45_000;

type MappingRow = {
  property_id: string;
  properties: { title: string | null } | null;
} | null;

async function readMapping(ad: PortalAdRef): Promise<MappingRow> {
  for (const table of [
    'property_portal_listings',
    'property_portal_listing_aliases',
  ] as const) {
    const { data, error } = await supabase
      .from(table)
      .select('property_id, properties(title)')
      .eq('portal', ad.portal)
      .eq('portal_listing_id', ad.portalListingId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as MappingRow;
  }
  return null;
}

export async function mapPortalAd(
  contactId: string,
  propertyId: string,
  ad: PortalAdRef
): Promise<PortalAdMapResult> {
  try {
    const { data } = await apiFetch<{
      data: { propertyTitle: string; taggedContacts: number };
    }>(`/api/contacts/${contactId}/portal-link`, {
      method: 'POST',
      body: JSON.stringify({ propertyId }),
      timeoutMs: PORTAL_LINK_TIMEOUT_MS,
    });
    return data;
  } catch (e) {
    if (!isTimeout(e)) throw e;
    const mapping = await readMapping(ad).catch(() => null);
    if (mapping?.property_id !== propertyId) throw e;
    return {
      propertyTitle: mapping.properties?.title ?? 'the listing',
      taggedContacts: null,
    };
  }
}
