'use client';

import { useRef, useState, ElementType } from 'react';
import { useRouter } from 'next/navigation';
import type { Property } from '@/types';
import { totalMonthlyRent } from '@/lib/inventory/floor-tenancies';
import { storagePublicUrl } from '@/lib/storage/url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  Eye,
  EyeOff,
  Edit,
  Trash2,
  Building,
  Home as HomeIcon,
  Loader2,
  Sparkles,
  Share2,
  Archive,
  ArchiveRestore,
  Megaphone,
  Mail,
  Star,
  Globe,
  Waypoints,
  ThumbsUp,
  Lock,
  Tag,
  Users,
  ShieldCheck,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PropertyConstructionLoader } from '@/components/ui/property-construction-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { gateSummary, type GateStatsMap } from '@/lib/inventory/gate-stats';
import { internalPhotoSources } from '@/lib/inventory/photo-sources';

const highlightIcons: Record<string, string> = {
  School: '🏫',
  Hospital: '🏥',
  'Metro Station': '🚇',
  Mall: '🛍️',
  Airport: '✈️',
  Highway: '🛣️',
  'Railway Station': '🚉',
  'Bus Stop': '🚏',
  Park: '🌳',
  Supermarket: '🛒',
};

interface PropertyListProps {
  properties: Property[];
  loading: boolean;
  onView: (property: Property) => void;
  onEdit: (property: Property) => void;
  onDelete: (property: Property) => void;
  onTogglePublish: (property: Property) => Promise<void>;
  onToggleStar?: (property: Property) => Promise<void>;
  canEdit: boolean;
  onFlyer?: (property: Property) => void;
  onPromote?: (property: Property) => void;
  onShare?: (property: Property) => void;
  onMatches?: (property: Property) => void;
  /** propertyId → number of matching buyer contacts, shown on the Matches button. */
  matchCounts?: Record<string, number>;
  onEmailShare?: (property: Property) => void;
  onPortals?: (property: Property) => void;
  /** propertyId → portal short codes ("99" | "MB" | "H") currently live. */
  portalBadges?: Record<string, string[]>;
  /** propertyId → confidential-gate rollup. Absent for every listing
   *  that is neither gated nor has request history. */
  gateStats?: GateStatsMap;
  /** Opens this listing's access requests. Without it the summary is
   *  still shown, just not clickable. */
  onGateRequests?: (property: Property) => void;
  onApprove?: (property: Property) => Promise<void>;
  onReject?: (property: Property) => Promise<void>;
  onArchive?: (property: Property) => Promise<void>;
  currency?: string;
}

export function PropertyList({
  properties,
  loading,
  onView,
  onEdit,
  onDelete,
  onTogglePublish,
  onToggleStar,
  canEdit,
  onFlyer,
  onPromote,
  onShare,
  onMatches,
  matchCounts,
  onEmailShare,
  onPortals,
  portalBadges,
  gateStats,
  onGateRequests,
  onApprove,
  onReject,
  onArchive,
  currency = 'INR',
}: PropertyListProps) {
  const router = useRouter();
  // Keyed by listing, not a single id: approving publishes the listing,
  // syncs the catalog and notifies the owner, so a reviewer works down
  // the queue while the first one is still running. A single decidingId
  // dropped the indicator off whichever card was decided first, and the
  // one that finished first re-enabled the other mid-flight.
  const inFlight = useRef<Map<string, 'approve' | 'reject'>>(new Map());
  const [deciding, setDeciding] = useState<Map<string, 'approve' | 'reject'>>(
    new Map()
  );

  async function decide(property: Property, verdict: 'approve' | 'reject') {
    const run = verdict === 'approve' ? onApprove : onReject;
    // Only the same listing twice is refused — deciding the next one
    // while this is running is the point.
    if (!run || inFlight.current.has(property.id)) return;
    inFlight.current.set(property.id, verdict);
    setDeciding(new Map(inFlight.current));
    try {
      await run(property);
    } finally {
      inFlight.current.delete(property.id);
      setDeciding(new Map(inFlight.current));
    }
  }
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Format currency helper (Lakhs and Crores standard for real estate)
  function formatPrice(amount: number) {
    if (currency === 'INR') {
      if (amount >= 10000000) {
        const cr = amount / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
      } else if (amount >= 100000) {
        const lakhs = amount / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  const statusColors: Record<string, string> = {
    Available: 'bg-green-500/10 text-green-400 border-green-500/30',
    'Under Contract': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    Sold: 'bg-slate-800 text-slate-400 border-slate-700',
    'Off Market': 'bg-red-500/10 text-red-400 border-red-500/30',
    'Pending Review': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    Rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
  };

  function getTypeIcon(propType: string): ElementType {
    const lowerType = propType.toLowerCase();
    if (
      lowerType.includes('apartment') ||
      lowerType.includes('flat') ||
      lowerType.includes('penthouse') ||
      lowerType.includes('studio') ||
      lowerType.includes('floor')
    ) {
      return Building;
    }
    if (lowerType.includes('house') || lowerType.includes('villa')) {
      return HomeIcon;
    }
    if (
      lowerType.includes('land') ||
      lowerType.includes('plot') ||
      lowerType.includes('agricultural')
    ) {
      return MapPin;
    }
    return Building;
  }

  async function handleTogglePublish(property: Property) {
    setTogglingId(property.id);
    try {
      await onTogglePublish(property);
    } finally {
      setTogglingId(null);
    }
  }

  const [starringId, setStarringId] = useState<string | null>(null);

  async function handleToggleStar(property: Property) {
    if (!onToggleStar) return;
    setStarringId(property.id);
    try {
      await onToggleStar(property);
    } finally {
      setStarringId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <PropertyConstructionLoader
          size={104}
          label="Loading property inventory"
          className="mb-3"
        />
        <ConvoRealLoader size={20} className="mb-2" />
        <p className="text-sm">Loading property inventory...</p>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 py-16 text-center">
        <Building className="mx-auto mb-4 size-12 text-slate-600" />
        <h3 className="mb-1 text-lg font-semibold text-white">
          No listings found
        </h3>
        <p className="mx-auto max-w-sm text-sm text-slate-400">
          Create property records or adjust search filters to view inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {properties.map((property) => {
        const TypeIcon = getTypeIcon(property.type);
        const verdict = deciding.get(property.id);
        // Gating moves photos into the guarded bucket, so a confidential
        // listing's cover is not in `images` at all.
        const cover = internalPhotoSources(property)[0];
        const mainImage = cover
          ? cover.guarded
            ? cover.url
            : storagePublicUrl(cover.url)
          : null;
        const isLand = [
          'Residential Land/ Plot',
          'Commercial Land',
          'Industrial Land',
          'Agricultural Land',
        ].includes(property.type);

        return (
          <div
            key={property.id}
            className="group flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 transition-all duration-300 hover:border-slate-700 hover:shadow-md"
          >
            {/* Card Thumbnail */}
            <div className="relative h-48 w-full shrink-0 overflow-hidden bg-slate-950">
              {mainImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mainImage}
                  alt={property.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    // Fallback on load error
                    (e.target as HTMLImageElement).src = '';
                  }}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-600">
                  <Building className="size-10 opacity-40" />
                  <span className="text-xs">No photos uploaded</span>
                </div>
              )}

              {/* Status Badge */}
              <div className="absolute top-3 left-3 flex max-w-[calc(100%-4rem)] flex-wrap gap-1.5">
                <Badge
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
                    property.listing_type === 'Rent'
                      ? 'border-blue-500/30 bg-blue-500/20 text-blue-400'
                      : property.listing_type === 'JV/JD'
                        ? 'border-purple-500/30 bg-purple-500/20 text-purple-400'
                        : property.listing_type === 'Built to Suit'
                          ? 'border-amber-500/30 bg-amber-500/20 text-amber-400'
                          : 'bg-primary/20 text-primary border-primary/30'
                  }`}
                >
                  {property.listing_type === 'Rent'
                    ? 'For Rent'
                    : property.listing_type === 'JV/JD'
                      ? 'JV / JD'
                      : property.listing_type === 'Built to Suit'
                        ? 'Built to Suit'
                        : 'For Sale'}
                </Badge>
                <Badge
                  className={
                    property.status === 'Sold'
                      ? 'scale-105 animate-pulse rounded-full border border-red-500 bg-red-600 px-2.5 py-0.5 text-xs font-black tracking-wider text-white uppercase shadow-md shadow-red-950/50'
                      : `rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
                          statusColors[property.status] ||
                          'border-slate-700 bg-slate-800 text-slate-300'
                        }`
                  }
                >
                  {property.status}
                </Badge>
                {property.listing_source === 'agent' && (
                  <Badge className="rounded-full border-sky-600 bg-sky-500/90 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase">
                    Agent Referred
                  </Badge>
                )}
                {property.listing_source === 'whatsapp_lister' && (
                  <Badge className="rounded-full border-emerald-700 bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase">
                    Submitted via WhatsApp
                  </Badge>
                )}
              </div>

              {/* Publication Status Overlay */}
              <div className="absolute top-3 right-3 flex flex-col gap-1.5">
                {onToggleStar && (
                  <button
                    type="button"
                    disabled={!canEdit || starringId === property.id}
                    onClick={() => handleToggleStar(property)}
                    className={`flex items-center justify-center rounded-full p-2 backdrop-blur-md transition-all ${
                      property.is_starred
                        ? 'bg-amber-500/95 text-slate-950 hover:bg-amber-400'
                        : 'bg-slate-950/80 text-slate-400 hover:text-amber-400'
                    } border border-slate-800/60 disabled:opacity-50`}
                    title={
                      property.is_starred
                        ? 'Starred — shown as an interest filter on Contacts. Click to unstar.'
                        : 'Star — pin as an interest filter chip on the Contacts page'
                    }
                  >
                    {starringId === property.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Star
                        className={`size-3.5 ${property.is_starred ? 'fill-current' : ''}`}
                      />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canEdit || togglingId === property.id}
                  onClick={() => handleTogglePublish(property)}
                  className={`flex items-center justify-center rounded-full p-2 backdrop-blur-md transition-all ${
                    property.is_published
                      ? 'bg-primary/95 text-primary-foreground hover:bg-primary'
                      : 'bg-slate-950/80 text-slate-400 hover:text-white'
                  } border border-slate-800/60 disabled:opacity-50`}
                  title={
                    property.is_published
                      ? 'Showcased Publicly — Click to Hide'
                      : 'Private Listing — Click to Showcase'
                  }
                >
                  {togglingId === property.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : property.is_published ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex flex-1 flex-col justify-between p-5">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-primary flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                    <TypeIcon className="size-3.5" />
                    {property.type}
                  </div>
                  <div className="flex items-center gap-1">
                    {(portalBadges?.[property.id] || []).map((code) => (
                      <span
                        key={code}
                        title={`Live on ${code === '99' ? '99acres' : code === 'MB' ? 'MagicBricks' : 'Housing.com'}`}
                        className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-black text-emerald-400"
                      >
                        {code}
                      </span>
                    ))}
                    {(property.like_count ?? 0) > 0 && (
                      <span
                        className="text-primary bg-primary/10 border-primary/25 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold"
                        title={`${property.like_count} showcase ${property.like_count === 1 ? 'like' : 'likes'}`}
                      >
                        <ThumbsUp className="size-3" />
                        {property.like_count}
                      </span>
                    )}
                    {(property.rating_count ?? 0) > 0 && (
                      <span
                        className="flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400"
                        title={`Average buyer rating ${((property.rating_total ?? 0) / (property.rating_count ?? 1)).toFixed(1)}/10 from ${property.rating_count} ${property.rating_count === 1 ? 'visitor' : 'visitors'}`}
                      >
                        <Star className="size-3" />
                        {(
                          (property.rating_total ?? 0) /
                          (property.rating_count ?? 1)
                        ).toFixed(1)}
                      </span>
                    )}
                    {property.property_code && (
                      <span
                        className="rounded bg-slate-950/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-400 select-all"
                        title="Copy Property Code"
                      >
                        {property.property_code}
                      </span>
                    )}
                  </div>
                </div>
                {property.project && (
                  <div
                    className="mb-1 flex items-center gap-1 truncate text-xs font-semibold text-slate-300"
                    title={property.project}
                  >
                    <span>🏢</span>{' '}
                    <span className="truncate">{property.project}</span>
                  </div>
                )}
                <h4
                  className="group-hover:text-primary mb-1 line-clamp-1 text-base font-bold text-white transition-colors"
                  title={property.title}
                >
                  {property.title}
                </h4>
                <div className="mb-3 flex items-center gap-1 text-xs text-slate-400">
                  <MapPin className="size-3.5 shrink-0 text-slate-500" />
                  <span className="truncate" title={property.location}>
                    {property.location}
                  </span>
                  {property.location_guarded && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-400 uppercase"
                      title="Exact location restricted — visible to admins and the listing agent only"
                    >
                      <Lock className="size-2.5" /> Guarded
                    </span>
                  )}
                  {property.showcase_visibility === 'teaser' && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-violet-300 uppercase"
                      title="Confidential — the public link shows only type, locality and a price band until you approve a viewer"
                    >
                      <ShieldCheck className="size-2.5" /> Confidential
                    </span>
                  )}
                  {property.location_tier === 'exact' && (
                    <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-emerald-400 uppercase">
                      In area
                    </span>
                  )}
                  {property.location_tier === 'nearby' &&
                    property.distance_km !== null &&
                    property.distance_km !== undefined && (
                      <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-400">
                        {property.distance_km} km away
                      </span>
                    )}
                </div>

                {/* Demand on a confidential listing. Rendered only once
                    something has happened — a gated listing nobody has
                    asked about says "Confidential" and nothing more,
                    rather than a row of zeroes on every card. */}
                {gateSummary(gateStats?.[property.id]) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGateRequests?.(property);
                    }}
                    className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2 py-1 text-[10px] font-bold text-violet-200 hover:border-violet-500/50 hover:bg-violet-500/15"
                    title="Access requests for this confidential listing"
                  >
                    <Users className="size-3" />
                    {gateSummary(gateStats?.[property.id])}
                  </button>
                )}

                <div className="mb-4 flex items-center justify-between">
                  <div className="text-lg font-black text-white">
                    {property.listing_type === 'Rent' ||
                    property.listing_type === 'Built to Suit' ? (
                      <span className="flex flex-col">
                        <span>
                          {formatPrice(property.rent_per_month || 0)}/mo
                        </span>
                        {property.maintenance && property.maintenance > 0 ? (
                          <span className="text-[10px] font-medium text-slate-400">
                            + {formatPrice(property.maintenance)} Maint.
                          </span>
                        ) : null}
                      </span>
                    ) : property.listing_type === 'JV/JD' ? (
                      <span className="flex flex-col">
                        <span>
                          {property.owner_share_percent &&
                          property.builder_share_percent
                            ? `${property.owner_share_percent}:${property.builder_share_percent} share`
                            : 'JV / JD'}
                        </span>
                        {property.price > 0 && (
                          <span className="text-[10px] font-medium text-slate-400">
                            Est. {formatPrice(property.price)}
                          </span>
                        )}
                      </span>
                    ) : (
                      formatPrice(property.price)
                    )}
                  </div>
                  {property.owner && (
                    <div
                      className="flex items-center gap-1 rounded border border-slate-800 bg-slate-800/40 px-2 py-0.5 text-xs text-slate-400"
                      title={`${property.owner.name} (${property.owner.phone})`}
                    >
                      <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                        {property.owner.classification || 'Owner'}:
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-350 font-semibold">
                          {property.owner.name || 'Unnamed'}
                        </span>
                        <NameTagBadge tag={property.owner.name_tag} />
                      </span>
                    </div>
                  )}
                </div>

                {/* Specs Row */}
                <div className="mb-4 grid grid-cols-3 gap-2 border-y border-slate-800 py-3 text-xs font-medium text-slate-300">
                  {[
                    'Flat/ Apartment',
                    'Residential House',
                    'Villa',
                    'Builder Floor Apartment',
                    'Penthouse',
                    'Studio Apartment',
                    'Farm House',
                  ].includes(property.type) ? (
                    <>
                      <div className="flex items-center justify-center gap-1.5">
                        <BedDouble className="size-4 text-slate-500" />
                        <span>
                          {property.bedrooms !== null &&
                          property.bedrooms !== undefined
                            ? `${property.bedrooms} Beds`
                            : '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-1.5 border-x border-slate-800">
                        <Bath className="size-4 text-slate-500" />
                        <span>
                          {property.bathrooms !== null &&
                          property.bathrooms !== undefined
                            ? `${property.bathrooms} Baths`
                            : '--'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-center gap-1.5">
                        <Building className="size-4 text-slate-500" />
                        <span className="truncate" title={property.type}>
                          {property.type.split('/')[0].split(' ')[0]}
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-1.5 border-x border-slate-800">
                        <MapPin className="size-4 text-slate-500" />
                        <span
                          className="truncate"
                          title={property.sublocality || '--'}
                        >
                          {property.sublocality || '--'}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-center gap-1.5">
                    <Maximize2 className="size-3.5 text-slate-500" />
                    <span>
                      {isLand
                        ? property.land_area
                          ? `${property.land_area.toLocaleString('en-IN')} ${property.land_area_unit || 'Sq.Ft.'}`
                          : '--'
                        : property.area_sqft
                          ? `${property.area_sqft.toLocaleString('en-IN')} ${property.area_unit || 'Sq.Ft.'}`
                          : '--'}
                    </span>
                  </div>
                </div>

                {/* Extended Specs & Commercial Details */}
                {property.super_built_area ||
                (!isLand && property.land_area) ||
                (isLand && property.area_sqft) ||
                property.land_zone ||
                property.ideal_for ||
                property.dimensions ||
                property.road_width ||
                property.facing_direction ||
                property.rental_income ? (
                  <div className="mb-4 flex flex-col gap-1.5 px-1 text-[11px] font-medium text-slate-400">
                    {/* Areas */}
                    {(property.super_built_area ||
                      (!isLand && property.land_area) ||
                      (isLand && property.area_sqft)) && (
                      <div className="flex flex-wrap justify-between gap-y-2">
                        {property.super_built_area ? (
                          <div>
                            Super Built:{' '}
                            <span className="text-slate-200">
                              {property.super_built_area.toLocaleString(
                                'en-IN'
                              )}{' '}
                              Sq.Ft.
                            </span>
                          </div>
                        ) : null}
                        {!isLand && property.land_area ? (
                          <div>
                            Land Area:{' '}
                            <span className="text-slate-200">
                              {property.land_area.toLocaleString('en-IN')}{' '}
                              {property.land_area_unit || 'Sq.Ft.'}
                            </span>
                          </div>
                        ) : null}
                        {isLand && property.area_sqft ? (
                          <div>
                            Built-up Area:{' '}
                            <span className="text-slate-200">
                              {property.area_sqft.toLocaleString('en-IN')}{' '}
                              {property.area_unit || 'Sq.Ft.'}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Dimensions & Zone/Ideal */}
                    {(property.dimensions ||
                      property.land_zone ||
                      property.ideal_for) && (
                      <div className="flex flex-wrap justify-between gap-y-2 border-t border-slate-800/45 pt-1.5">
                        {property.dimensions ? (
                          <div>
                            Dimensions:{' '}
                            <span className="text-slate-200">
                              {property.dimensions}
                            </span>
                          </div>
                        ) : property.land_zone ? (
                          <div>
                            Zone:{' '}
                            <span className="text-slate-200">
                              {property.land_zone}
                            </span>
                          </div>
                        ) : null}
                        {property.ideal_for ? (
                          <div
                            className="max-w-[150px] truncate"
                            title={property.ideal_for}
                          >
                            Ideal for:{' '}
                            <span className="text-slate-200">
                              {property.ideal_for}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Road and Direction Details */}
                    {(property.road_width ||
                      property.facing_direction ||
                      (property.dimensions && property.land_zone)) && (
                      <div className="flex flex-wrap justify-between gap-y-2 border-t border-slate-800/45 pt-1.5">
                        {property.road_width ? (
                          <div>
                            Road Width:{' '}
                            <span className="text-slate-200">
                              {property.road_width}{' '}
                              {property.road_width_unit || 'Feet'}
                            </span>
                          </div>
                        ) : property.dimensions && property.land_zone ? (
                          <div>
                            Zone:{' '}
                            <span className="text-slate-200">
                              {property.land_zone}
                            </span>
                          </div>
                        ) : null}
                        {property.facing_direction ? (
                          <div>
                            Facing:{' '}
                            <span className="text-slate-200">
                              {property.facing_direction}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Rental Income & ROI details */}
                    {property.rental_income ? (
                      <div className="flex flex-wrap justify-between gap-y-2 border-t border-slate-800/45 pt-1.5">
                        <div>
                          Monthly Rent:{' '}
                          <span className="text-slate-200">
                            {formatPrice(property.rental_income)}/month
                          </span>
                        </div>
                        {property.roi ? (
                          <div>
                            ROI (Yield):{' '}
                            <span className="text-primary font-semibold">
                              {property.roi}%
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {/* Floor-wise rent roll (pre-leased commercial) */}
                    {property.floor_tenancies &&
                    property.floor_tenancies.length > 0 ? (
                      <div className="flex flex-wrap justify-between gap-y-2 border-t border-slate-800/45 pt-1.5">
                        <div>
                          Rent Roll:{' '}
                          <span className="text-slate-200">
                            {property.floor_tenancies.length} floor
                            {property.floor_tenancies.length > 1 ? 's' : ''}
                            {property.floor_tenancies.some(
                              (ft) => ft.tenant_name
                            )
                              ? ' tenanted'
                              : ''}
                          </span>
                        </div>
                        {totalMonthlyRent(property.floor_tenancies) ? (
                          <div>
                            <span className="text-slate-200">
                              {formatPrice(
                                totalMonthlyRent(property.floor_tenancies)!
                              )}
                              /mo
                            </span>{' '}
                            <span className="text-slate-500">excl. GST</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {/* Rental details for Rent / Built to Suit listings */}
                    {(property.listing_type === 'Rent' ||
                      property.listing_type === 'Built to Suit') &&
                    (property.advance || property.gst) ? (
                      <div className="flex flex-wrap justify-between gap-y-2 border-t border-slate-800/45 pt-1.5 text-[10px]">
                        {property.advance ? (
                          <div>
                            Deposit:{' '}
                            <span className="text-slate-200">
                              {formatPrice(property.advance)}
                            </span>
                          </div>
                        ) : null}
                        {property.gst ? (
                          <div>
                            GST:{' '}
                            <span className="text-slate-200">
                              {formatPrice(property.gst)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {/* JV/JD deal terms */}
                    {property.listing_type === 'JV/JD' &&
                    (property.jv_structure || property.goodwill_amount) ? (
                      <div className="flex flex-wrap justify-between gap-y-2 border-t border-slate-800/45 pt-1.5 text-[10px]">
                        {property.jv_structure ? (
                          <div>
                            Structure:{' '}
                            <span className="text-slate-200">
                              {property.jv_structure}
                            </span>
                          </div>
                        ) : null}
                        {property.goodwill_amount ? (
                          <div>
                            Goodwill:{' '}
                            <span className="text-slate-200">
                              {formatPrice(property.goodwill_amount)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Features Badges */}
                {property.features && property.features.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1">
                    {property.features.slice(0, 3).map((feature, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="rounded border-slate-800 bg-slate-950/40 px-2 py-0.5 text-[10px] font-normal text-slate-400"
                      >
                        {feature}
                      </Badge>
                    ))}
                    {property.features.length > 3 && (
                      <Badge
                        variant="outline"
                        className="rounded border-slate-800 bg-slate-950/40 px-1.5 py-0.5 text-[10px] font-normal text-slate-500"
                      >
                        +{property.features.length - 3} more
                      </Badge>
                    )}
                  </div>
                )}

                {/* Tags (Engine-only) */}
                {property.tags && property.tags.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1">
                    {property.tags.map((tag, i) => (
                      <span
                        key={i}
                        title="Internal tag — never shown to clients"
                        className="bg-primary/10 border-primary/20 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                      >
                        <Tag className="size-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Nearby Highlights */}
                {property.nearby_highlights &&
                  property.nearby_highlights.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-1 border-t border-slate-800/40 pt-3">
                      <span className="mb-1 block w-full text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                        Nearby Landmarks
                      </span>
                      {property.nearby_highlights
                        .slice(0, 4)
                        .map((highlight, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="flex items-center gap-1 rounded-full border-slate-800/80 bg-slate-950/20 px-2 py-0.5 text-[10px] font-normal text-slate-300"
                          >
                            <span>{highlightIcons[highlight] || '📍'}</span>
                            <span>{highlight}</span>
                          </Badge>
                        ))}
                      {property.nearby_highlights.length > 4 && (
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-800/80 bg-slate-950/20 px-1.5 py-0.5 text-[10px] font-normal text-slate-500"
                        >
                          +{property.nearby_highlights.length - 4} more
                        </Badge>
                      )}
                    </div>
                  )}

                {/* Interested Contacts / Leads */}
                {property.interested_contacts &&
                  property.interested_contacts.length > 0 && (
                    <div className="mt-4 border-t border-slate-800/40 pt-3">
                      <span className="mb-1.5 block text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                        Interested Leads ({property.interested_contacts.length})
                      </span>
                      {/* Capped + scrollable: a hot listing can have dozens of
                        leads, and an unbounded list stretches the card (and
                        its whole grid row) past the viewport. */}
                      <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto pr-1">
                        {property.interested_contacts.map((contact) => (
                          <div
                            key={contact.id}
                            className="flex items-center justify-between rounded border border-slate-800/40 bg-slate-950/20 px-2.5 py-1 text-xs transition-all hover:border-slate-800"
                          >
                            <span
                              className="flex max-w-[150px] items-center gap-1.5 truncate font-semibold text-slate-200"
                              title={contact.name}
                            >
                              <span className="truncate">
                                👤 {contact.name || 'Unnamed'}
                              </span>
                              <NameTagBadge tag={contact.name_tag} />
                            </span>
                            <div className="flex items-center gap-1.5 font-semibold">
                              <span className="text-slate-450 font-mono text-[10px]">
                                {contact.phone}
                              </span>
                              <span className="rounded border border-slate-800/40 bg-slate-950/50 px-1 text-[9px] text-slate-400">
                                {contact.classification}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>

              {/* Action Buttons */}
              <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-slate-800/60 pt-2">
                {canEdit &&
                  property.status === 'Pending Review' &&
                  onApprove && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={verdict !== undefined}
                      onClick={() => decide(property, 'approve')}
                      className="h-8 bg-green-600 font-medium text-white hover:bg-green-700"
                    >
                      {verdict === 'approve' && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      )}
                      Approve
                    </Button>
                  )}
                {canEdit &&
                  property.status === 'Pending Review' &&
                  onReject && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={verdict !== undefined}
                      onClick={() => decide(property, 'reject')}
                      className="h-8 border-red-900/50 text-red-400 hover:bg-red-950/20 hover:text-red-400"
                    >
                      {verdict === 'reject' && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      )}
                      Reject
                    </Button>
                  )}
                <TooltipProvider>
                  {onFlyer && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onFlyer(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Sparkles className="text-primary mr-1.5 size-3.5" />{' '}
                          Flyer
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        AI Flyer Creator
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {onPromote && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onPromote(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Megaphone className="text-primary mr-1.5 size-3.5" />{' '}
                          Promote
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Create Meta ad campaign
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {onShare && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onShare(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Share2 className="text-primary mr-1.5 size-3.5" />{' '}
                          Share
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Share property listing
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {onMatches && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onMatches(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Users className="mr-1.5 size-3.5 text-emerald-400" />{' '}
                          Matches
                          {matchCounts?.[property.id] !== undefined && (
                            <span
                              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                matchCounts[property.id] > 0
                                  ? 'border border-emerald-500/25 bg-emerald-500/15 text-emerald-400'
                                  : 'border border-slate-700 bg-slate-800 text-slate-500'
                              }`}
                            >
                              {matchCounts[property.id]}
                            </span>
                          )}
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Matching contacts for this property
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            router.push(`/journey?property=${property.id}`)
                          }
                          className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                        />
                      }
                    >
                      <>
                        <Waypoints className="mr-1.5 size-3.5 text-sky-400" />{' '}
                        Journey
                      </>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Mind map of interested contacts
                    </TooltipContent>
                  </Tooltip>
                  {onEmailShare && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onEmailShare(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Mail className="text-primary mr-1.5 size-3.5" />{' '}
                          Email
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Share via email
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {onPortals && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onPortals(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Globe className="text-primary mr-1.5 size-3.5" />{' '}
                          Post Ad
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Post on 99acres / MagicBricks / Housing
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onView(property)}
                          className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                        />
                      }
                    >
                      <>
                        <Eye className="mr-1.5 size-3.5" /> Details
                      </>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      View property details
                    </TooltipContent>
                  </Tooltip>
                  {canEdit && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onEdit(property)}
                            className="h-8 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                          />
                        }
                      >
                        <>
                          <Edit className="mr-1.5 size-3.5" /> Edit
                        </>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Edit property details
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {canEdit && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onDelete(property)}
                            className="border-slate-850 h-8 text-slate-400 hover:border-red-900/50 hover:bg-red-950/20 hover:text-red-400"
                          />
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Delete property
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {canEdit &&
                    onArchive &&
                    property.status !== 'Pending Review' && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onArchive(property)}
                              className={
                                property.status === 'Archived'
                                  ? 'h-8 border-amber-800/50 text-amber-400 hover:border-amber-700/50 hover:bg-amber-950/20 hover:text-amber-400'
                                  : 'h-8 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white'
                              }
                            />
                          }
                        >
                          {property.status === 'Archived' ? (
                            <ArchiveRestore className="size-3.5" />
                          ) : (
                            <Archive className="size-3.5" />
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {property.status === 'Archived'
                            ? 'Restore property'
                            : 'Archive property'}
                        </TooltipContent>
                      </Tooltip>
                    )}
                </TooltipProvider>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
