'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import type { Property } from '@/types';
import {
  publicMapAreaLabel,
  publicMapAreas,
  publicMapProperties,
} from '@/lib/showcase/public-map';
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
  shortlistedPropertyIds,
  onClose,
}: {
  properties: Property[];
  currency: string;
  onOpen: (property: Property) => void;
  shortlistedPropertyIds: string[];
  onClose: () => void;
}) {
  const mapped = useMemo(() => publicMapProperties(properties), [properties]);
  const areas = useMemo(() => publicMapAreas(properties), [properties]);
  const shortlistedAreas = useMemo(
    () =>
      publicMapAreas(
        properties.filter((property) =>
          shortlistedPropertyIds.includes(property.id)
        )
      ),
    [properties, shortlistedPropertyIds]
  );
  const latestShortlisted = (() => {
    for (
      let index = shortlistedPropertyIds.length - 1;
      index >= 0;
      index -= 1
    ) {
      const property = properties.find(
        (item) => item.id === shortlistedPropertyIds[index]
      );
      const label = property ? publicMapAreaLabel(property) : '';
      if (property && label) return { id: property.id, areaLabel: label };
    }
    return null;
  })();
  const shortlistedExact = latestShortlisted
    ? mapped.find((property) => property.id === latestShortlisted.id)
    : undefined;
  const shortlistedArea = latestShortlisted
    ? areas.find(
        (item) =>
          item.label.toLocaleLowerCase('en-IN') ===
          latestShortlisted.areaLabel.toLocaleLowerCase('en-IN')
      )
    : undefined;
  const [areaLabel, setAreaLabel] = useState(shortlistedArea?.label ?? '');
  const [pinnedAreaLabel, setPinnedAreaLabel] = useState(
    shortlistedExact ? '' : (shortlistedArea?.label ?? '')
  );
  const [focusedId, setFocusedId] = useState(shortlistedExact?.id ?? '');
  const [mapMode, setMapMode] = useState<'area' | 'exact'>(
    shortlistedExact || (mapped.length > 0 && !shortlistedArea)
      ? 'exact'
      : 'area'
  );
  const area = areas.find((item) => item.label === areaLabel) ?? areas[0];
  const showArea = mapMode === 'area';
  const focused = showArea
    ? undefined
    : (mapped.find((property) => property.id === focusedId) ?? mapped[0]);
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
        <div className="flex items-center gap-2">
          <span className="text-xs">
            {focused
              ? `${mapped.length} on map`
              : `${areas.length} ${areas.length === 1 ? 'area' : 'areas'}`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Close map"
            title="Close map"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {!focused && area ? (
        <>
          <div className="px-4 pb-3">
            {pinnedAreaLabel === area.label && (
              <p className="bg-primary/10 text-primary mb-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
                <MapPin className="size-3" />
                Pinned from shortlist
              </p>
            )}
            <label className="text-xs font-medium">
              Area on map
              <select
                aria-label="Area on map"
                className="mt-1 min-h-11 w-full rounded-lg border bg-transparent px-3 text-sm"
                value={area.label}
                onChange={(event) => {
                  setAreaLabel(event.target.value);
                  setPinnedAreaLabel('');
                  setMapMode('area');
                }}
              >
                {areas.map((item) => (
                  <option key={item.label} value={item.label}>
                    {item.label} · {item.count}{' '}
                    {item.count === 1 ? 'property' : 'properties'}
                  </option>
                ))}
              </select>
            </label>
            {shortlistedAreas.length > 0 && (
              <div
                className="mt-3 flex flex-wrap items-center gap-2"
                aria-label="Shortlisted areas"
              >
                <span className="text-xs font-medium">Shortlisted areas</span>
                {shortlistedAreas.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      area.label === item.label
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:border-primary'
                    }`}
                    onClick={() => {
                      setAreaLabel(item.label);
                      setPinnedAreaLabel(item.label);
                      setMapMode('area');
                    }}
                  >
                    {item.label} · {item.count}
                  </button>
                ))}
              </div>
            )}
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
                onChange={(event) => {
                  setFocusedId(event.target.value);
                  setMapMode('exact');
                }}
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
