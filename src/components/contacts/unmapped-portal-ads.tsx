'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link as LinkIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import { createClient } from '@/lib/supabase/client';
import type { Property } from '@/types';
import type { UnmappedPortalAd } from '@/app/api/portals/unmapped-ads/route';

/**
 * The portal ads with leads waiting and no listing mapped to them yet.
 *
 * Each row is one ad, however many enquiries arrived on it — mapping it
 * is a single decision, and asking once per lead is how a queue stops
 * being used. Until the mapping exists the lead webhook can only score
 * each enquiry against inventory, which is what puts three different
 * buyers on the same bungalow; asserting the ad settles all of its leads
 * at once and every later one resolves without a guess.
 */
export function UnmappedPortalAds({ onMapped }: { onMapped: () => void }) {
  const [ads, setAds] = useState<UnmappedPortalAd[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [mapping, setMapping] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portals/unmapped-ads');
      if (!res.ok) return;
      const body = await res.json();
      setAds(Array.isArray(body?.data) ? body.data : []);
    } catch {
      // A queue that fails to load is a quiet no-op: it is a prompt to
      // act, never a blocker on reading the contacts underneath it.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Inventory for the picker, loaded only once an ad is actually waiting
  // — an account with nothing to map pays nothing for this panel.
  useEffect(() => {
    if (ads.length === 0 || properties.length > 0) return;
    void (async () => {
      const { data } = await createClient()
        .from('properties')
        .select(
          'id, title, property_code, location, sublocality, project, price, type, bedrooms, area_sqft, area_unit, images'
        )
        .order('created_at', { ascending: false });
      setProperties((data ?? []) as Property[]);
    })();
  }, [ads.length, properties.length]);

  async function mapAd(ad: UnmappedPortalAd, propertyId: string) {
    setMapping(ad.portalListingId);
    try {
      const res = await fetch(
        `/api/contacts/${ad.sampleContactId}/portal-link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not map the ad');

      const tagged = body.data?.taggedContacts ?? 0;
      toast.success(
        `${ad.portal} ad ${ad.portalListingId} → "${body.data?.propertyTitle}". ` +
          `${tagged} lead${tagged === 1 ? '' : 's'} tagged; new ones match automatically.`
      );
      setAds((prev) =>
        prev.filter((a) => a.portalListingId !== ad.portalListingId)
      );
      onMapped();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not map the ad');
    } finally {
      setMapping(null);
    }
  }

  if (ads.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <LinkIcon className="size-3.5 shrink-0 text-amber-400" />
        <span className="text-xs font-bold text-amber-300">
          {ads.length} portal ad{ads.length === 1 ? '' : 's'} not mapped to a
          listing
        </span>
        <span className="truncate text-[11px] text-slate-500">
          Say which listing each one is — once. Their leads are tagged now, and
          every later enquiry on the ad matches without guessing.
        </span>
      </div>

      <div className="space-y-2">
        {ads.map((ad) => (
          <div
            key={`${ad.portal}:${ad.portalListingId}`}
            className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-900/60 p-2.5 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">
                  {ad.portal} ad {ad.portalListingId}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                  {ad.leadCount} lead{ad.leadCount === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {ad.sampleContactName ? `${ad.sampleContactName} · ` : ''}
                {ad.guessedPropertyTitle
                  ? `currently guessed as "${ad.guessedPropertyTitle}"`
                  : 'no listing tagged'}
              </p>
            </div>
            <div className="w-full sm:w-72">
              {mapping === ad.portalListingId ? (
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Loader2 className="text-primary size-3.5 animate-spin" />
                  Mapping…
                </div>
              ) : (
                <SearchablePropertySelect
                  properties={properties}
                  value={null}
                  onChange={(propertyId) => propertyId && mapAd(ad, propertyId)}
                  placeholder="Which listing is this ad?"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
