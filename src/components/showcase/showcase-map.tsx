'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { Property } from '@/types';
import { publicMapAreas, publicMapProperties } from '@/lib/showcase/public-map';
import { Button } from '@/components/ui/button';

const PropertyMapView = dynamic(
  () =>
    import('@/components/inventory/property-map-view').then(
      (module) => module.PropertyMapView
    ),
  { ssr: false }
);

export function ShowcaseMap({
  properties,
  currency,
  onOpen,
}: {
  properties: Property[];
  currency: string;
  onOpen: (property: Property) => void;
}) {
  const mapped = useMemo(() => publicMapProperties(properties), [properties]);
  const areas = useMemo(() => publicMapAreas(properties), [properties]);
  const [areaLabel, setAreaLabel] = useState('');
  const area = areas.find((item) => item.label === areaLabel) ?? areas[0];
  const [focusedId, setFocusedId] = useState('');
  const focused =
    mapped.find((property) => property.id === focusedId) ?? mapped[0];
  return (
    <section
      aria-label="Property locations"
      className="showcase-map-panel overflow-hidden rounded-2xl border"
    >
      <div className="flex items-center justify-between gap-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="size-4" />
          Explore locations
        </h2>
        <span className="text-xs">
          {focused
            ? `${mapped.length} on map`
            : `${areas.length} ${areas.length === 1 ? 'area' : 'areas'}`}
        </span>
      </div>
      {!focused && area ? (
        <>
          <div className="px-4 pb-3">
            <label className="text-xs font-medium">
              Area on map
              <select
                aria-label="Area on map"
                className="mt-1 min-h-11 w-full rounded-lg border bg-transparent px-3 text-sm"
                value={area.label}
                onChange={(event) => setAreaLabel(event.target.value)}
              >
                {areas.map((item) => (
                  <option key={item.label} value={item.label}>
                    {item.label} · {item.count}{' '}
                    {item.count === 1 ? 'property' : 'properties'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <iframe
            title={`Area map: ${area.label}`}
            className="h-[26rem] w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://maps.google.com/maps?q=${encodeURIComponent(area.label)}&z=13&output=embed`}
          />
        </>
      ) : !focused ? (
        <div className="flex min-h-40 items-center justify-center p-8 text-center text-sm">
          No public area information is available for these listings. Explore
          the property cards to enquire about a location.
        </div>
      ) : process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ? (
        <PropertyMapView
          properties={mapped}
          loading={false}
          center={null}
          onOpen={onOpen}
          currency={currency}
          appearance="light"
        />
      ) : (
        <>
          <div className="px-4 pb-3">
            <label className="text-xs font-medium">
              Property on map
              <select
                aria-label="Property on map"
                className="mt-1 min-h-11 w-full rounded-lg border bg-transparent px-3 text-sm"
                value={focused.id}
                onChange={(event) => setFocusedId(event.target.value)}
              >
                {mapped.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <iframe
            title={`Map of ${focused.title}`}
            className="h-[26rem] w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://maps.google.com/maps?q=${focused.latitude},${focused.longitude}&z=14&output=embed`}
          />
          <div className="p-3">
            <Button className="min-h-11 w-full" onClick={() => onOpen(focused)}>
              View property details
            </Button>
          </div>
        </>
      )}
      <p className="border-t p-3 text-xs">
        {focused
          ? 'Only publicly shared locations appear on this map.'
          : 'Area overview only. Exact property locations are shared on request.'}
      </p>
    </section>
  );
}
