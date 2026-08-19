'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';

import { formatCurrencyShort } from '@/lib/currency-utils';
import { readStoredJson, writeStored } from '@/lib/safe-storage';
import { PORTALS, type PortalKey } from '@/lib/portals/post-kit';
import type { PortalDriftFinding } from '@/app/api/portals/drift/route';

/**
 * Mapped portal ads whose recorded state has diverged from reality —
 * withdrawn stock still advertised, stale expiries, silently lapsed ads,
 * details edited on one side only. Computed server-side by
 * portal_listing_drift (migration 267) from leads and sync logs already
 * in the database, so it needs nothing from the portals themselves.
 *
 * Stateless: fixing the condition (relist, update the expiry, mark the
 * ad removed in the Post to Portals dialog) is what clears a row.
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

const PORTAL_DRIFT_DISMISS_KEY = 'convoreal_portal_drift_dismissed_v1';
type DismissedSignatures = Record<string, string>;

function signatureFor(finding: PortalDriftFinding): string {
  return JSON.stringify({
    portal: finding.portal,
    portalListingId: finding.portalListingId,
    propertyId: finding.propertyId,
    driftKind: finding.driftKind,
    propertyStatus: finding.propertyStatus,
    expiresOn: finding.expiresOn,
    parsedPropertyType: finding.parsedPropertyType,
    parsedPrice: finding.parsedPrice,
    parsedAreaSqft: finding.parsedAreaSqft,
    listingType: finding.listingType,
    listingPrice: finding.listingPrice,
    listingAreaSqft: finding.listingAreaSqft,
    leadCount: finding.leadCount,
  });
}

export function PortalDriftPanel() {
  const [dismissedSignatures, setDismissedSignatures] = useState(
    () => readStoredJson<DismissedSignatures>(PORTAL_DRIFT_DISMISS_KEY, {})
  );

  const { data: findings } = useQuery({
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

  const visibleFindings = useMemo(() => {
    const list = findings ?? [];
    return list.filter(
      (finding) => dismissedSignatures[signatureFor(finding)] !== signatureFor(finding)
    );
  }, [findings, dismissedSignatures]);

  const dismissPanel = () => {
    const next: DismissedSignatures = { ...dismissedSignatures };
    for (const finding of findings ?? []) {
      const key = signatureFor(finding);
      next[key] = key;
    }
    setDismissedSignatures(next);
    writeStored(PORTAL_DRIFT_DISMISS_KEY, JSON.stringify(next));
  };

  if (visibleFindings.length === 0) return null;

  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0 text-rose-400" />
        <span className="text-xs font-bold text-rose-300">
          {visibleFindings.length} portal ad{visibleFindings.length === 1 ? '' : 's'} out of
          step with your inventory
        </span>
        <button
          type="button"
          onClick={dismissPanel}
          aria-label="Dismiss portal drift alert"
          title="Dismiss alert"
          className="ml-auto inline-flex items-center justify-center rounded-md border border-rose-500/40 p-1 text-rose-200/75 transition-colors hover:bg-rose-500/10 hover:text-rose-100"
        >
          <X className="size-3.5" />
        </button>
        <span className="truncate text-[11px] text-slate-500">
          Spotted from the leads and emails already in the Engine — the row
          clears itself once the ad and the listing agree again.
        </span>
      </div>

      <div className="space-y-2">
        {visibleFindings.map((f) => (
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
