'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';

import { formatCurrencyShort } from '@/lib/currency-utils';
import { PORTALS, type PortalKey } from '@/lib/portals/post-kit';
import type { PortalDriftFinding } from '@/app/api/portals/drift/route';
import { useAuth } from '@/hooks/use-auth';
import { readStored, removeStored, writeStored } from '@/lib/safe-storage';

const DISMISS_KEY_PREFIX = 'convoreal.portalDrift.dismissed:v1';

function findingSignature(findings: PortalDriftFinding[]): string {
  return [...findings]
    .map(
      (f) =>
        `${f.portal}|${f.portalListingId}|${f.propertyId}|${f.driftKind}|${f.propertyStatus ?? ''}`
    )
    .sort()
    .join('::');
}

/**
 * Mapped portal ads whose recorded state has diverged from reality —
 * withdrawn stock still advertised, stale expiries, silently lapsed ads,
 * details edited on one side only. Computed server-side by
 * portal_listing_drift (migration 267) from leads and sync logs already
 * in the database, so it needs nothing from the portals themselves.
 */

function portalLabel(portal: string): string {
  return PORTALS[portal as PortalKey]?.label || portal;
}

function expiryLabel(expiresOn: string | null): string {
  return expiresOn
    ? format(new Date(`${expiresOn}T00:00:00`), 'd MMM yyyy')
    : 'its expiry';
}

function findingHeadline(f: PortalDriftFinding): string {
  switch (f.driftKind) {
    case 'withdrawn_stock':
      return 'Ad live on withdrawn stock';
    case 'stale_expiry':
      return 'Leads after the recorded expiry';
    case 'likely_lapsed':
      return 'Ad probably lapsed';
    case 'details_drift':
      return 'Ad and listing disagree';
  }
}

function findingDetail(f: PortalDriftFinding): string {
  const leads = `${f.leadCount} lead${f.leadCount === 1 ? '' : 's'}`;
  switch (f.driftKind) {
    case 'withdrawn_stock':
      return `${leads} in the last 30 days, but the listing is ${f.propertyStatus}. You are paying for an ad on withdrawn stock — take it down, or relist the property.`;
    case 'stale_expiry':
      return `${leads} arrived after ${expiryLabel(f.expiresOn)}, so the ad is still live and the recorded expiry is stale. Update it in the Post to Portals dialog.`;
    case 'likely_lapsed':
      return `No leads since it expired on ${expiryLabel(f.expiresOn)}. Renew it on the portal, or mark it removed.`;
    case 'details_drift': {
      const pairs: string[] = [];
      if (f.parsedPropertyType && f.listingType) {
        pairs.push(`${f.parsedPropertyType} vs ${f.listingType}`);
      }
      if (f.parsedPrice !== null && f.listingPrice !== null) {
        pairs.push(
          `${formatCurrencyShort(f.parsedPrice)} vs ${formatCurrencyShort(f.listingPrice)}`
        );
      }
      if (f.parsedAreaSqft !== null && f.listingAreaSqft !== null) {
        pairs.push(`${f.parsedAreaSqft} vs ${f.listingAreaSqft} sq ft`);
      }
      return `Its last lead email says ${pairs.join(', ')} (ad vs listing) — one side was edited and the other was not.`;
    }
  }
}

export function PortalDriftPanel() {
  const { accountId } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);
  const { data: findings, isLoading } = useQuery({
    queryKey: ['portal-drift'],
    queryFn: async () => {
      const res = await fetch('/api/portals/drift');
      if (!res.ok) throw new Error('Could not load portal drift');
      const body = await res.json();
      return (
        Array.isArray(body?.data) ? body.data : []
      ) as PortalDriftFinding[];
    },
    staleTime: 5 * 60_000,
  });

  const active = useMemo(() => findings ?? [], [findings]);
  const signature = useMemo(() => findingSignature(active), [active]);
  const storageKey = accountId
    ? `${DISMISS_KEY_PREFIX}:${accountId}`
    : null;

  useEffect(() => {
    if (!storageKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDismissed(false);
      return;
    }

    if (isLoading) {
      return;
    }

    if (!active.length) {
      if (storageKey) {
        removeStored(storageKey);
      }
      setIsDismissed(false);
      return;
    }

    const dismissedSignature = readStored(storageKey);
    if (dismissedSignature !== signature) {
      removeStored(storageKey);
      setIsDismissed(false);
      return;
    }

    setIsDismissed(true);
  }, [isLoading, active.length, storageKey, signature]);

  function hideBanner() {
    if (!storageKey || !signature) return;
    writeStored(storageKey, signature);
    setIsDismissed(true);
  }

  if (!active || active.length === 0 || isDismissed) return null;

  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0 text-rose-400" />
        <span className="text-xs font-bold text-rose-300">
          {active.length} portal ad{active.length === 1 ? '' : 's'} out of
          step with your inventory
        </span>
        <span className="truncate text-[11px] text-slate-500">
          Spotted from the leads and emails already in the Engine — the row
          clears itself once the ad and the listing agree again.
        </span>
        <button
          type="button"
          onClick={hideBanner}
          aria-label="Dismiss portal discrepancy banner"
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-400/30 text-rose-300 transition hover:border-rose-300 hover:bg-rose-500/10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        {active.map((f) => (
          <div
            key={`${f.portal}:${f.portalListingId}:${f.driftKind}`}
            className="rounded-md border border-slate-800 bg-slate-900/60 p-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-white">
                {findingHeadline(f)}
              </span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                {portalLabel(f.portal)} ad {f.portalListingId}
              </span>
              <span className="truncate text-[11px] text-slate-400">
                {f.propertyTitle || 'Untitled listing'}
                {f.propertyCode ? ` (${f.propertyCode})` : ''}
              </span>
              {f.listingUrl && (
                <a
                  href={f.listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex shrink-0 items-center gap-1 text-[11px] font-semibold text-rose-300 hover:text-rose-200"
                >
                  View ad <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {findingDetail(f)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
