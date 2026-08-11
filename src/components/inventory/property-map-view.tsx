'use client';

// ============================================================
// Map of the CURRENT Inventory search — the web port of the mobile
// app's Properties map. Pins for every result with coordinates; rows
// without coordinates simply don't appear (the backfill script and
// the near-search self-heal geocodes over time).
//
// Rendered with the Google Maps JS API loaded straight from a script
// tag — no npm dependency. The key is a separate BROWSER key
// (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, referrer-restricted), never
// the server-side GOOGLE_MAPS_API_KEY. Without it the view degrades
// to an explanatory panel instead of breaking Inventory.
//
// Pins are the mobile app's price pills (violet, gold dot), drawn as
// OverlayView HTML so no Map ID / advanced-marker setup is needed.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPinOff } from 'lucide-react';
import { formatCurrencyShort } from '@/lib/currency-utils';
import { useT } from '@/hooks/use-locale';
import type { Property } from '@/types';

const BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

/* eslint-disable @typescript-eslint/no-explicit-any */
type GoogleMaps = any;

let mapsPromise: Promise<GoogleMaps> | null = null;

function loadGoogleMaps(): Promise<GoogleMaps> {
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const existing = (window as any).google?.maps;
    if (existing) return resolve(existing);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&loading=async`;
    script.async = true;
    script.onload = () => {
      const maps = (window as any).google?.maps;
      if (maps) resolve(maps);
      else reject(new Error('Google Maps failed to initialise'));
    };
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

/** Night styling so the map sits inside the dark dashboard instead of
 *  glowing at it. Standard Google night palette, slate-shifted. */
const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#334155' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0f172a' }],
  },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#475569' }],
  },
];

interface PinProperty extends Property {
  latitude: number;
  longitude: number;
}

function pinPrice(property: Property, currency: string) {
  if (property.listing_type === 'Rent') {
    return property.rent_per_month
      ? `${formatCurrencyShort(property.rent_per_month, currency)}/mo`
      : '—';
  }
  return property.price ? formatCurrencyShort(property.price, currency) : '—';
}

export function PropertyMapView({
  properties,
  loading,
  center,
  onOpen,
  currency,
}: {
  properties: Property[];
  loading: boolean;
  /** Active near-filter centre (locality pick or Near me), if any. */
  center: { latitude: number; longitude: number } | null;
  onOpen: (property: Property) => void;
  currency: string;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  const pinned = useMemo(
    () =>
      properties.filter(
        (p): p is PinProperty =>
          typeof p.latitude === 'number' && typeof p.longitude === 'number'
      ),
    [properties]
  );

  useEffect(() => {
    if (!BROWSER_KEY || !containerRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: center
              ? { lat: center.latitude, lng: center.longitude }
              : { lat: 20.5937, lng: 78.9629 },
            zoom: center ? 13 : 5,
            styles: DARK_MAP_STYLES,
            disableDefaultUI: true,
            zoomControl: true,
            clickableIcons: false,
            backgroundColor: '#0f172a',
          });
        }
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // The map is created once; centre changes are handled by the
    // fit-bounds effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const maps = (window as any).google.maps;
    const map = mapRef.current;

    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];

    class PricePin extends maps.OverlayView {
      private el: HTMLButtonElement | null = null;
      constructor(private readonly property: PinProperty) {
        super();
      }
      onAdd() {
        const el = document.createElement('button');
        el.type = 'button';
        const muted = this.property.status !== 'Available';
        el.style.cssText = [
          'position:absolute',
          'transform:translate(-50%,-100%)',
          'display:flex',
          'align-items:center',
          'gap:5px',
          'padding:4px 10px',
          'border-radius:999px',
          `background:${muted ? '#334155' : '#7C3AED'}`,
          'border:1.5px solid rgba(255,255,255,0.9)',
          `color:${muted ? '#94a3b8' : '#ffffff'}`,
          'font:700 11px system-ui,sans-serif',
          'white-space:nowrap',
          'cursor:pointer',
          'box-shadow:0 2px 8px rgba(2,6,23,0.5)',
        ].join(';');
        const dot = document.createElement('span');
        dot.style.cssText = `width:6px;height:6px;border-radius:999px;background:${
          muted ? '#64748b' : '#E5A50A'
        }`;
        el.appendChild(dot);
        el.appendChild(
          document.createTextNode(pinPrice(this.property, currency))
        );
        el.title = this.property.title;
        el.addEventListener('click', () => onOpenRef.current(this.property));
        this.el = el;
        this.getPanes()?.overlayMouseTarget.appendChild(el);
      }
      draw() {
        if (!this.el) return;
        const point = this.getProjection()?.fromLatLngToDivPixel(
          new maps.LatLng(this.property.latitude, this.property.longitude)
        );
        if (!point) return;
        this.el.style.left = `${point.x}px`;
        this.el.style.top = `${point.y}px`;
      }
      onRemove() {
        this.el?.remove();
        this.el = null;
      }
    }

    for (const property of pinned) {
      const pin = new PricePin(property);
      pin.setMap(map);
      overlaysRef.current.push(pin);
    }

    if (pinned.length > 0) {
      const bounds = new maps.LatLngBounds();
      for (const p of pinned)
        bounds.extend({ lat: p.latitude, lng: p.longitude });
      if (center)
        bounds.extend({ lat: center.latitude, lng: center.longitude });
      map.fitBounds(bounds, 64);
    } else if (center) {
      map.setCenter({ lat: center.latitude, lng: center.longitude });
      map.setZoom(13);
    }
  }, [status, pinned, center, currency]);

  if (!BROWSER_KEY) {
    return (
      <div className="flex h-[32rem] flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 text-center">
        <MapPinOff className="size-6 text-slate-600" />
        <p className="text-sm text-slate-400">
          {t('inventory.mapNotConfigured')}
        </p>
        <p className="max-w-md text-xs text-slate-600">
          Set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY to a referrer-restricted
          Google Maps JavaScript API key to enable it. The mobile app&apos;s map
          works independently of this.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-[32rem] overflow-hidden rounded-xl border border-slate-800">
      <div ref={containerRef} className="absolute inset-0" />
      {(status === 'loading' || loading) && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
          <Loader2 className="size-6 animate-spin text-slate-400" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/80 text-center">
          <MapPinOff className="size-6 text-slate-600" />
          <p className="text-sm text-slate-400">{t('inventory.mapFailed')}</p>
        </div>
      )}
      {status === 'ready' && !loading && (
        <div className="absolute bottom-3 left-3 rounded-full border border-slate-700 bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur">
          {pinned.length === 0
            ? t('inventory.mapNone')
            : `${pinned.length}/${properties.length} ${t('inventory.mapped')}`}
        </div>
      )}
    </div>
  );
}
