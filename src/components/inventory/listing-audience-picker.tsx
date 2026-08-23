'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Users2, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  audienceListingLabel,
  fetchAudienceListings,
  fetchListingAudience,
  reachableAudienceIds,
  type AudienceListing,
} from '@/lib/inventory/listing-audience';

interface ListingAudiencePickerProps {
  accountId: string | null;
  /** The contact rows the caller can already select by id. */
  loadedContacts: { id: string; phone?: string | null }[];
  onSelect: (contactIds: string[]) => void;
}

export function ListingAudiencePicker({
  accountId,
  loadedContacts,
  onSelect,
}: ListingAudiencePickerProps) {
  const [open, setOpen] = useState(false);
  const [listings, setListings] = useState<AudienceListing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || listings !== null || !accountId) return;
    let cancelled = false;
    setLoading(true);
    fetchAudienceListings(createClient(), accountId)
      .then((rows) => {
        if (!cancelled) setListings(rows);
      })
      .catch((err) => {
        console.error('[listing-audience] listings failed:', err);
        if (!cancelled) {
          setListings([]);
          toast.error('Failed to load listing audiences');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, listings, accountId]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const applyListing = useCallback(
    async (listing: AudienceListing) => {
      if (!accountId) return;
      setApplyingId(listing.propertyId);
      try {
        const audience = await fetchListingAudience(
          createClient(),
          accountId,
          listing.propertyId
        );
        const { ids, unreachable } = reachableAudienceIds(
          audience,
          loadedContacts
        );
        if (ids.length === 0) {
          toast.error(
            `Nobody in ${audienceListingLabel(listing)}'s audience can be messaged on WhatsApp`
          );
          return;
        }
        onSelect(ids);
        setOpen(false);
        toast.success(
          `Selected ${ids.length} contact${ids.length === 1 ? '' : 's'} from ${audienceListingLabel(listing)}` +
            (unreachable > 0
              ? ` · ${unreachable} skipped (no WhatsApp number)`
              : '')
        );
      } catch (err) {
        console.error('[listing-audience] audience failed:', err);
        toast.error('Failed to load that listing’s audience');
      } finally {
        setApplyingId(null);
      }
    },
    [accountId, loadedContacts, onSelect]
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={!accountId}
        className="border-slate-850 flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border bg-slate-950/20 px-3.5 py-2.5 text-left hover:border-slate-800 disabled:opacity-50"
      >
        <span className="flex items-center gap-2 text-xs text-slate-300">
          <Users2 className="text-primary size-3.5" />
          <span className="font-semibold">
            Share with a listing&apos;s audience
          </span>
          <span className="hidden text-slate-500 sm:inline">
            everyone who enquired about or viewed another listing
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-1 shadow-xl">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
              <Loader2 className="text-primary size-3.5 animate-spin" />
              Loading listings…
            </div>
          ) : (listings ?? []).length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">
              No listing has an engaged audience yet. Enquiries and tracked
              showcase views build one.
            </p>
          ) : (
            (listings ?? []).map((listing) => (
              <button
                key={listing.propertyId}
                type="button"
                disabled={applyingId !== null}
                onClick={() => applyListing(listing)}
                className="hover:bg-slate-850 flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs text-slate-200">
                    {listing.title || 'Untitled listing'}
                  </span>
                  {listing.propertyCode && (
                    <span className="block text-[10px] text-slate-500">
                      {listing.propertyCode}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-primary text-[10px] font-bold">
                    {listing.contactsCount} contact
                    {listing.contactsCount === 1 ? '' : 's'}
                  </span>
                  {applyingId === listing.propertyId && (
                    <Loader2 className="text-primary size-3 animate-spin" />
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
