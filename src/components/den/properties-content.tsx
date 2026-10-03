'use client';

// Owners Den — property list.

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { formatINR, DEAL_MODE_META } from './format';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { storagePublicUrl } from '@/lib/storage/url';
import { Building2, MapPin, Plus } from 'lucide-react';

export interface DenProperty {
  id: string;
  account_id: string;
  title: string;
  description?: string | null;
  price: number | null;
  location: string;
  type: string;
  status: string;
  listing_type?: string | null;
  rent_per_month?: number | null;
  maintenance?: number | null;
  advance?: number | null;
  gst?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_sqft?: number | null;
  city?: string | null;
  is_published: boolean;
  features?: string[];
  nearby_highlights?: string[];
  images: string[];
  property_code?: string | null;
  deal_mode?: string;
  agency_name?: string | null;
  created_at: string;
}

export function DenPropertiesContent() {
  const [properties, setProperties] = useState<DenProperty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/den/properties')
      .then((res) => (res.ok ? res.json() : { properties: [] }))
      .then((body) => {
        setProperties(body.properties || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight">My Properties</h1>
          <p className="text-muted-foreground text-sm font-medium">
            Everything you own, across all your agencies.
          </p>
        </div>
        <Link
          href="/den/properties/new"
          className={cn(buttonVariants({ size: 'sm' }), 'text-xs font-bold')}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add property
        </Link>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">
          Loading your properties…
        </p>
      ) : properties.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Building2 className="text-muted-foreground h-8 w-8" />
            <p className="text-sm font-semibold">No properties yet</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              List your first property — residential, commercial or land, for
              sale or rent.
            </p>
            <Link
              href="/den/properties/new"
              className={cn(
                buttonVariants({ size: 'sm' }),
                'text-xs font-bold'
              )}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> List my property
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {properties.map((p) => {
            const dealMeta =
              DEAL_MODE_META[p.deal_mode ?? 'off'] ?? DEAL_MODE_META.off;
            return (
              <Link key={p.id} href={`/den/properties/${p.id}`}>
                <Card className="hover:border-primary/40 h-full overflow-hidden pt-0 transition-all hover:shadow-md">
                  <div className="bg-muted relative h-36 w-full">
                    {p.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={storagePublicUrl(p.images[0])}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Building2 className="text-muted-foreground h-8 w-8" />
                      </div>
                    )}
                    <span
                      className={`absolute top-2 right-2 rounded-full px-2.5 py-1 text-[10px] font-black backdrop-blur ${dealMeta.badgeClass}`}
                    >
                      {dealMeta.label}
                    </span>
                    {p.status === 'Pending Review' && (
                      <span className="absolute top-2 left-2 rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-[10px] font-black text-sky-600 backdrop-blur">
                        Pending review
                      </span>
                    )}
                  </div>
                  <CardContent className="flex flex-col gap-1 p-4">
                    <p className="truncate text-sm font-bold">{p.title}</p>
                    <p className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.location}</span>
                    </p>
                    <p className="text-primary text-sm font-black">
                      {p.listing_type === 'Rent'
                        ? `${formatINR(p.rent_per_month)} / month`
                        : formatINR(p.price)}
                    </p>
                    <p className="text-muted-foreground text-[11px] font-semibold">
                      {p.type}
                      {p.agency_name ? ` · managed by ${p.agency_name}` : ''}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
