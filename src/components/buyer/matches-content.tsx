'use client';

// ============================================================
// Buyer portal — listings matched to the buyer's brief.
//
// Two sections with deliberately different fidelity: listings from the
// agencies that already hold this buyer as a contact are shown in
// full, while cross-tenant Deal Mode matches stay masked (locality and
// price band) until an agent makes the introduction. The server
// enforces that split; this only renders it.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  BedDouble,
  Bath,
  ExternalLink,
  Lock,
  MapPin,
  Ruler,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MatchProperty {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  sublocality: string | null;
  city: string | null;
  type: string | null;
  listing_type: string | null;
  rent_per_month: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  area_unit: string | null;
  images: string[] | null;
}

interface MatchCard {
  score: number;
  reasons: string[];
  agency_name: string | null;
  showcase_path: string;
  property: MatchProperty;
}

interface DealModeCard {
  event_id: string;
  agency_name: string | null;
  score: number;
  chips: string[];
  listing: {
    type: string;
    listing_type: string;
    locality: string | null;
    city: string | null;
    price_band: string | null;
    rent_band: string | null;
    bedrooms: number | null;
    area_sqft: number | null;
    area_unit: string | null;
  };
}

interface MatchFeed {
  curated: MatchCard[];
  deal_mode: DealModeCard[];
  pool_capped: boolean;
  has_preferences: boolean;
}

function formatPrice(value: number | null): string | null {
  if (value == null || value <= 0) return null;
  if (value >= 10000000)
    return `₹${(value / 10000000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (value >= 100000)
    return `₹${(value / 100000).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function BuyerMatchesContent() {
  const [feed, setFeed] = useState<MatchFeed | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/buyer/matches');
      if (!res.ok) {
        toast.error('Could not load your matches');
        return;
      }
      setFeed((await res.json()) as MatchFeed);
    })();
  }, []);

  if (feed === null) {
    return <p className="text-muted-foreground text-sm">Finding your matches…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight">My Matches</h1>
          <p className="text-muted-foreground text-sm font-medium">
            Listings that fit your brief, refreshed as new ones come in.
          </p>
        </div>
        <Link
          href="/buyer/preferences"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'text-xs font-bold'
          )}
        >
          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
          Edit preferences
        </Link>
      </div>

      {!feed.has_preferences ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <SlidersHorizontal className="text-muted-foreground/40 h-10 w-10" />
            <p className="text-sm font-semibold">Tell us what you&apos;re after</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              Add a budget and the areas you&apos;d consider, and matching listings will
              start showing up here — and on WhatsApp as new ones land.
            </p>
            <Link
              href="/buyer/preferences"
              className={cn(buttonVariants({ size: 'sm' }), 'mt-1 text-xs font-bold')}
            >
              Set my preferences
            </Link>
          </CardContent>
        </Card>
      ) : feed.curated.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Sparkles className="text-muted-foreground/40 h-10 w-10" />
            <p className="text-sm font-semibold">Nothing fits your brief just yet</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              Widening the budget or adding an area usually helps. Your agent is looking
              too — plenty never reaches a website.
            </p>
            <Link
              href="/buyer/preferences"
              className={cn(buttonVariants({ size: 'sm' }), 'mt-1 text-xs font-bold')}
            >
              Adjust my preferences
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {feed.curated.map((match) => {
            const p = match.property;
            const locality =
              [p.sublocality, p.city].filter(Boolean).join(', ') || p.location;
            const price =
              p.listing_type === 'Rent'
                ? formatPrice(p.rent_per_month)?.concat('/mo')
                : formatPrice(p.price);
            const cover = p.images?.[0];
            return (
              <Card key={p.id} className="overflow-hidden pt-0">
                <div className="bg-muted relative aspect-[4/3] w-full">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover}
                      alt={p.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="text-muted-foreground/40 flex h-full w-full items-center justify-center">
                      <MapPin className="h-8 w-8" />
                    </div>
                  )}
                  <Badge className="absolute top-2 left-2 text-[10px] font-bold">
                    {match.score}% fit
                  </Badge>
                </div>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-bold">{p.title}</p>
                    {price && (
                      <p className="text-primary shrink-0 text-sm font-black">{price}</p>
                    )}
                  </div>
                  {locality && (
                    <p className="text-muted-foreground flex items-center gap-1 text-xs">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{locality}</span>
                    </p>
                  )}
                  <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                    {p.bedrooms ? (
                      <span className="flex items-center gap-1">
                        <BedDouble className="h-3 w-3" /> {p.bedrooms} BHK
                      </span>
                    ) : null}
                    {p.bathrooms ? (
                      <span className="flex items-center gap-1">
                        <Bath className="h-3 w-3" /> {p.bathrooms}
                      </span>
                    ) : null}
                    {p.area_sqft ? (
                      <span className="flex items-center gap-1">
                        <Ruler className="h-3 w-3" />{' '}
                        {p.area_sqft.toLocaleString('en-IN')} {p.area_unit || 'sqft'}
                      </span>
                    ) : null}
                  </div>
                  {match.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {match.reasons.map((reason) => (
                        <span
                          key={reason}
                          className="border-primary/20 bg-primary/5 text-primary rounded-full border px-2 py-0.5 text-[10px] font-bold"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}
                  {match.agency_name && (
                    <p className="text-muted-foreground text-[10px] font-medium">
                      With {match.agency_name}
                    </p>
                  )}
                  <Link
                    href={match.showcase_path}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      buttonVariants({ size: 'sm', variant: 'outline' }),
                      'mt-1 text-xs font-bold'
                    )}
                  >
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    View listing
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {feed.pool_capped && (
        <p className="text-muted-foreground text-[11px]">
          Showing the best of the most recent listings — your agent can search the full
          inventory.
        </p>
      )}

      {feed.deal_mode.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-black tracking-tight">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Direct from owners
            </h2>
            <p className="text-muted-foreground text-xs">
              Owners selling directly, matched to your brief. Details open up once your
              agent makes the introduction.
            </p>
          </div>
          {feed.deal_mode.map((match) => (
            <Card key={match.event_id} className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex flex-wrap items-center gap-4">
                <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                  <Lock className="h-5 w-5 text-amber-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {match.listing.bedrooms ? `${match.listing.bedrooms} BHK ` : ''}
                    {match.listing.type}
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {match.listing.locality ||
                      match.listing.city ||
                      'Area shared on request'}
                  </p>
                  {match.chips.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {match.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-black">
                    {match.listing.rent_band
                      ? `${match.listing.rent_band}/mo`
                      : match.listing.price_band || 'On request'}
                  </p>
                  <p className="text-[10px] font-bold text-amber-600">
                    {match.score}% fit
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
