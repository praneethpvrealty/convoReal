'use client';

// Buyer portal — saved properties with view / enquire CTAs.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Heart,
  MapPin,
  BedDouble,
  Bath,
  Ruler,
  ExternalLink,
  Trash2,
  Search,
} from 'lucide-react';

import { useBuyer } from './buyer-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface ShortlistProperty {
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
  available: boolean;
}

interface ShortlistItem {
  id: string;
  source: 'manual' | 'rating' | 'like';
  created_at: string;
  agency_name: string | null;
  showcase_path: string;
  property: ShortlistProperty;
}

function formatPrice(value: number | null): string | null {
  if (value == null || value <= 0) return null;
  if (value >= 10000000)
    return `₹${(value / 10000000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (value >= 100000)
    return `₹${(value / 100000).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function BuyerShortlistContent() {
  const { me } = useBuyer();
  const [items, setItems] = useState<ShortlistItem[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/buyer/shortlist');
      if (!res.ok) {
        toast.error('Could not load your shortlist');
        return;
      }
      const body = (await res.json()) as { items: ShortlistItem[] };
      setItems(body.items);
    })();
  }, []);

  const handleRemove = async (item: ShortlistItem) => {
    setRemoving(item.id);
    const res = await fetch(`/api/buyer/shortlist/${item.id}`, {
      method: 'DELETE',
    });
    setRemoving(null);
    if (!res.ok) {
      toast.error('Could not remove the property');
      return;
    }
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    toast.success('Removed from your shortlist');
  };

  if (items === null) {
    return (
      <p className="text-muted-foreground text-sm">Loading your shortlist…</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-black tracking-tight">My Shortlist</h1>
        <p className="text-muted-foreground text-sm font-medium">
          Properties you liked or rated highly, saved in one place.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Heart className="text-muted-foreground/40 h-10 w-10" />
            <p className="text-sm font-semibold">Nothing shortlisted yet</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              Browse{me?.links.length ? " your agency's" : ' a'} property
              showcase and rate or like properties — they&apos;ll show up here
              automatically.
            </p>
            <Link
              href="/"
              className={cn(
                buttonVariants({ size: 'sm' }),
                'mt-1 text-xs font-bold'
              )}
            >
              <Search className="mr-1 h-3.5 w-3.5" />
              Browse properties
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const p = item.property;
            const locality =
              [p.sublocality, p.city].filter(Boolean).join(', ') || p.location;
            const price =
              p.listing_type === 'Rent'
                ? formatPrice(p.rent_per_month)?.concat('/mo')
                : formatPrice(p.price);
            const cover = p.images?.[0];
            return (
              <Card key={item.id} className="overflow-hidden pt-0">
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
                  {!p.available && (
                    <Badge
                      variant="destructive"
                      className="absolute top-2 left-2 text-[10px]"
                    >
                      No longer available
                    </Badge>
                  )}
                </div>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-bold">{p.title}</p>
                    {price && (
                      <p className="text-primary shrink-0 text-sm font-black">
                        {price}
                      </p>
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
                        {p.area_sqft.toLocaleString('en-IN')}{' '}
                        {p.area_unit || 'sqft'}
                      </span>
                    ) : null}
                  </div>
                  {item.agency_name && (
                    <p className="text-muted-foreground text-[10px] font-medium">
                      with {item.agency_name}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <a
                      href={item.showcase_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        buttonVariants({ size: 'sm' }),
                        'flex-1 text-xs font-bold'
                      )}
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      View & Enquire
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={removing === item.id}
                      onClick={() => handleRemove(item)}
                      className="text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
