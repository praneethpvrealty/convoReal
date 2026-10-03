'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import {
  RefreshCw,
  Loader2,
  Link2,
  Plus,
  EyeOff,
  CheckCircle2,
  Download,
  Coins,
  CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PORTALS, type PortalKey } from '@/lib/portals/post-kit';
import { formatShareAmount } from '@/lib/share-message-builder';

interface HarvestBatch {
  portal: PortalKey;
  harvestedAt: number;
  pageUrl?: string;
  accountStats: {
    remainingListings?: number;
    remainingRefreshes?: number;
    planName?: string;
    planExpiresOn?: string;
  } | null;
  listings: Array<{
    listingId: string;
    listingUrl?: string | null;
    rawText: string;
  }>;
}

interface ImportItem {
  id: string;
  portal: PortalKey;
  portal_listing_id: string;
  listing_url: string | null;
  title: string | null;
  property_type: string | null;
  listing_for: string | null;
  price: number | null;
  bedrooms: number | null;
  area_sqft: number | null;
  locality: string | null;
  city: string | null;
  posted_on: string | null;
  expires_on: string | null;
  portal_status: string | null;
  views: number | null;
  responses: number | null;
  match_status: string;
  match_confidence: number | null;
  match_reasons: string[] | null;
  match_candidates: Array<{
    propertyId: string;
    score: number;
    title: string;
    location: string;
  }> | null;
}

interface PortalAccountRow {
  portal: PortalKey;
  remaining_listings: number | null;
  remaining_refreshes: number | null;
  plan_name: string | null;
  plan_expires_on: string | null;
  synced_at: string;
}

interface PropertyOption {
  id: string;
  title: string;
  property_code?: string | null;
  location?: string | null;
  sublocality?: string | null;
  project?: string | null;
  tags?: string[] | null;
}

interface PortalSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

/** Pulls the listings the Chrome extension harvested off the agent's
 *  own portal dashboards, stages them via /api/portal-import, and
 *  walks the agent through the match review — nothing is created
 *  without an explicit confirmation here. */
export function PortalSyncDialog({
  open,
  onOpenChange,
  onImported,
}: PortalSyncDialogProps) {
  const supabase = createClient();

  const [extensionDetected, setExtensionDetected] = useState(false);
  const [harvests, setHarvests] = useState<HarvestBatch[]>([]);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [portalAccounts, setPortalAccounts] = useState<PortalAccountRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [pulling, setPulling] = useState(false);
  const [stagingPortal, setStagingPortal] = useState<PortalKey | null>(null);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [linkChoice, setLinkChoice] = useState<Record<string, string | null>>(
    {}
  );
  const [lastSummary, setLastSummary] = useState<Record<string, number> | null>(
    null
  );

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/portal-import');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load import queue');
      setItems(json.data.items || []);
      setPortalAccounts(json.data.portalAccounts || []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load import queue'
      );
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    const { data } = await supabase
      .from('properties')
      .select('id, title, property_code, location, sublocality, project, tags')
      .neq('status', 'Archived')
      .order('created_at', { ascending: false })
      .limit(500);
    setProperties((data || []) as PropertyOption[]);
  }, [supabase]);

  const pullFromExtension = useCallback(() => {
    setPulling(true);
    window.postMessage(
      { type: 'CONVOREAL_HARVEST_PULL' },
      window.location.origin
    );
    setTimeout(() => setPulling(false), 1500);
  }, []);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin)
        return;
      const data = event.data as {
        type?: string;
        harvests?: HarvestBatch[];
        portal?: string;
      } | null;
      if (data?.type === 'CONVOREAL_PORTAL_EXT_PONG') {
        setExtensionDetected(true);
      } else if (data?.type === 'CONVOREAL_HARVEST_DATA') {
        setPulling(false);
        setHarvests((data.harvests || []).filter((h) => h.listings.length > 0));
      } else if (data?.type === 'CONVOREAL_HARVEST_CLEARED') {
        setHarvests((prev) => prev.filter((h) => h.portal !== data.portal));
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: 'CONVOREAL_PORTAL_EXT_PING' },
      window.location.origin
    );
    window.postMessage(
      { type: 'CONVOREAL_HARVEST_PULL' },
      window.location.origin
    );
    fetchPending();
    fetchProperties();
    return () => window.removeEventListener('message', onMessage);
  }, [open, fetchPending, fetchProperties]);

  const stageHarvest = async (harvest: HarvestBatch) => {
    setStagingPortal(harvest.portal);
    try {
      const res = await fetch('/api/portal-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portal: harvest.portal,
          harvestedAt: harvest.harvestedAt,
          pageUrl: harvest.pageUrl,
          listings: harvest.listings,
          accountStats: harvest.accountStats || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      const s = json.data.summary as Record<string, number>;
      setLastSummary(s);
      toast.success(
        `${PORTALS[harvest.portal].label}: ${s.linked + s.auto_matched} matched to existing properties, ${s.review} need review, ${s.new} new.`
      );
      window.postMessage(
        { type: 'CONVOREAL_HARVEST_CLEAR', portal: harvest.portal },
        window.location.origin
      );
      fetchPending();
      onImported?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      toast.error(
        msg.includes('portal_import')
          ? 'Run migration 124 to enable portal sync.'
          : msg
      );
    } finally {
      setStagingPortal(null);
    }
  };

  const commit = async (
    action: 'link' | 'create' | 'ignore',
    ids: string[],
    propertyId?: string
  ) => {
    setBusyItems((prev) => new Set([...prev, ...ids]));
    try {
      const res = await fetch('/api/portal-import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, itemIds: ids, propertyId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Commit failed');
      toast.success(
        action === 'link'
          ? 'Linked to your existing property.'
          : action === 'create'
            ? 'Imported into your inventory.'
            : 'Ignored.'
      );
      setSelectedNew((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      fetchPending();
      onImported?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setBusyItems((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const reviewItems = useMemo(
    () => items.filter((i) => i.match_status === 'review'),
    [items]
  );
  const newItems = useMemo(
    () => items.filter((i) => i.match_status === 'new'),
    [items]
  );

  const itemSummary = (item: ImportItem) => {
    const bits = [
      item.property_type,
      item.bedrooms ? `${item.bedrooms} BHK` : null,
      item.area_sqft ? `${item.area_sqft} sqft` : null,
      [item.locality, item.city].filter(Boolean).join(', ') || null,
      item.price ? formatShareAmount(item.price) : null,
      item.listing_for === 'Rent' ? 'Rent' : null,
    ].filter(Boolean);
    return bits.join(' · ');
  };

  const toggleNew = (id: string) => {
    setSelectedNew((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-700 bg-slate-900 text-slate-200 sm:max-w-3xl">
        <DialogHeader className="mb-2 border-b border-slate-800 pb-3">
          <DialogTitle className="flex items-center gap-2 text-lg font-black tracking-tight text-white">
            <RefreshCw className="text-primary size-5" />
            Sync Portal Listings
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Pull the listings you&apos;ve posted on 99acres / MagicBricks /
            Housing into ConvoReal. Everything is matched against your inventory
            first — duplicates are linked, never re-created, and nothing is
            imported without your confirmation.
          </DialogDescription>
        </DialogHeader>

        {/* Portal account stats */}
        {portalAccounts.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {portalAccounts.map((acc) => (
              <div
                key={acc.portal}
                className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3"
              >
                <div className="text-xs font-bold text-slate-200">
                  {PORTALS[acc.portal]?.label || acc.portal}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Coins className="size-3 text-amber-400" />
                  {acc.remaining_listings != null
                    ? `${acc.remaining_listings} listings left`
                    : 'Credits unknown'}
                  {acc.remaining_refreshes != null &&
                    ` · ${acc.remaining_refreshes} refreshes`}
                </div>
                {acc.plan_name && (
                  <div className="text-[10px] text-slate-500">
                    {acc.plan_name}
                  </div>
                )}
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <CalendarClock className="size-3" />
                  Synced{' '}
                  {new Date(acc.synced_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Extension harvest source */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  extensionDetected
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                    : 'bg-slate-600'
                )}
              />
              {extensionDetected ? (
                <span>
                  Extension detected. On the portal, open{' '}
                  <strong className="text-slate-200">My Listings</strong>, click{' '}
                  <strong className="text-slate-200">
                    Sync to Engine → Scan this page
                  </strong>{' '}
                  on each page, then pull here.
                </span>
              ) : (
                <span>
                  Autofill extension not detected — install it from{' '}
                  <code className="rounded bg-slate-900 px-1 text-slate-300">
                    extension/portal-autofill
                  </code>{' '}
                  to harvest your posted listings.
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!extensionDetected || pulling}
              onClick={pullFromExtension}
              className="hover:bg-slate-850 h-7 shrink-0 border-slate-800 text-xs text-slate-300"
            >
              {pulling ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Download className="mr-1 size-3" />
              )}
              Pull collected
            </Button>
          </div>

          {harvests.map((h) => (
            <div
              key={h.portal}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2"
            >
              <div className="min-w-0 text-xs text-emerald-300">
                <strong>{PORTALS[h.portal]?.label || h.portal}</strong> —{' '}
                {h.listings.length} listings collected
                {h.accountStats?.remainingListings != null &&
                  ` · ${h.accountStats.remainingListings} credits left`}
              </div>
              <Button
                size="sm"
                disabled={stagingPortal !== null}
                onClick={() => stageHarvest(h)}
                className="bg-primary text-primary-foreground h-7 px-3 text-xs"
              >
                {stagingPortal === h.portal ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 size-3" />
                )}
                Match &amp; import
              </Button>
            </div>
          ))}

          {lastSummary && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <CheckCircle2 className="size-3.5 text-emerald-400" />
              Last sync: {lastSummary.linked + lastSummary.auto_matched} updated
              existing properties, {lastSummary.review} for review,{' '}
              {lastSummary.new} new.
            </div>
          )}
        </div>

        {/* Needs review */}
        {reviewItems.length > 0 && (
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold text-slate-300">
              Needs review ({reviewItems.length}) — looks similar to existing
              inventory
            </Label>
            {reviewItems.map((item) => {
              const busy = busyItems.has(item.id);
              const chosen =
                linkChoice[item.id] ??
                item.match_candidates?.[0]?.propertyId ??
                null;
              return (
                <div
                  key={item.id}
                  className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-200">
                      {item.title || item.portal_listing_id}
                    </div>
                    <div className="truncate text-[11px] text-slate-400">
                      {PORTALS[item.portal]?.label} · {itemSummary(item)}
                    </div>
                    {item.match_candidates &&
                      item.match_candidates.length > 0 && (
                        <div className="mt-1 text-[10px] text-amber-300/80">
                          Possible match:{' '}
                          {item.match_candidates
                            .map((c) => c.title)
                            .filter(Boolean)
                            .join(' / ')}
                        </div>
                      )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-52 flex-1">
                      <SearchablePropertySelect
                        properties={properties}
                        value={chosen}
                        onChange={(v) =>
                          setLinkChoice((prev) => ({ ...prev, [item.id]: v }))
                        }
                        placeholder="Link to existing property…"
                        disabled={busy}
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || !chosen}
                      onClick={() =>
                        chosen && commit('link', [item.id], chosen)
                      }
                      className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
                    >
                      <Link2 className="mr-1 size-3" /> Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => commit('create', [item.id])}
                      className="h-8 border-slate-700 text-xs text-slate-300"
                    >
                      <Plus className="mr-1 size-3" /> Import as new
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => commit('ignore', [item.id])}
                      className="h-8 border-slate-800 text-xs text-slate-500"
                    >
                      <EyeOff className="mr-1 size-3" /> Ignore
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* New listings */}
        {newItems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold text-slate-300">
                Not in your Engine yet ({newItems.length})
              </Label>
              <Button
                size="sm"
                disabled={selectedNew.size === 0 || busyItems.size > 0}
                onClick={() => commit('create', [...selectedNew])}
                className="bg-primary text-primary-foreground h-7 px-3 text-xs"
              >
                <Plus className="mr-1 size-3" /> Import selected (
                {selectedNew.size})
              </Button>
            </div>
            <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800">
              {newItems.map((item) => {
                const busy = busyItems.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-slate-950/40 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNew.has(item.id)}
                      onChange={() => toggleNew(item.id)}
                      disabled={busy}
                      className="size-3.5 shrink-0 accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-slate-200">
                        {item.title || item.portal_listing_id}
                      </div>
                      <div className="truncate text-[10px] text-slate-500">
                        {PORTALS[item.portal]?.label} · {itemSummary(item)}
                        {item.expires_on &&
                          ` · expires ${new Date(`${item.expires_on}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => commit('ignore', [item.id])}
                      className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
                      title="Ignore this listing"
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <EyeOff className="size-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {harvests.length === 0 &&
          reviewItems.length === 0 &&
          newItems.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-500">
              Nothing to review. Collect listings on the portal with the
              extension&apos;s{' '}
              <strong className="text-slate-300">Sync to Engine</strong> button,
              then pull them here.
            </div>
          )}

        <div className="flex items-center justify-between border-t border-slate-800 pt-3.5">
          <span className="text-[10px] text-slate-500">
            Matched listings update expiry, views and status on your existing
            properties — no duplicates are created.
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="hover:bg-slate-850 h-9 border-slate-800 text-xs text-slate-300"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
