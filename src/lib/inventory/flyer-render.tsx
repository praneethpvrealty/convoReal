import { ImageResponse } from 'next/og';
import { formatFlyerPrice, type FlyerOptions } from './flyer-options';

export interface FlyerPropertyFields {
  title: string;
  property_code?: string | null;
  type?: string | null;
  price?: number | null;
  location?: string | null;
}

interface FlyerFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700 | 800;
  style: 'normal';
}

const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap';

let fontsPromise: Promise<FlyerFont[]> | null = null;

async function fetchInterFonts(): Promise<FlyerFont[]> {
  const cssRes = await fetch(FONT_CSS_URL, { signal: AbortSignal.timeout(5000) });
  if (!cssRes.ok) throw new Error(`Font CSS fetch failed (${cssRes.status})`);
  const css = await cssRes.text();

  const byWeight = new Map<number, string>();
  for (const match of css.matchAll(/font-weight:\s*(\d+);[^}]*?src:\s*url\(([^)]+)\)/g)) {
    const weight = Number(match[1]);
    if ([400, 700, 800].includes(weight) && !byWeight.has(weight)) {
      byWeight.set(weight, match[2]);
    }
  }
  if (byWeight.size === 0) throw new Error('No font faces found in CSS');

  return Promise.all(
    [...byWeight.entries()].map(async ([weight, url]) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Font fetch failed (${res.status})`);
      return {
        name: 'Inter',
        data: await res.arrayBuffer(),
        weight: weight as 400 | 700 | 800,
        style: 'normal' as const,
      };
    })
  );
}

async function loadFlyerFonts(): Promise<FlyerFont[]> {
  if (!fontsPromise) {
    fontsPromise = fetchInterFonts().catch((err) => {
      console.warn('[flyer-render] Font load failed, using default font:', err);
      fontsPromise = null;
      return [];
    });
  }
  return fontsPromise;
}

const ICON_PIN =
  'M12 2C8.13 2 5 5.13 5 8.5c0 5.25 7 13.5 7 13.5s7-8.25 7-13.5C19 5.13 15.87 2 12 2zm0 9.5a3 3 0 110-6 3 3 0 010 6z';
const ICON_PHONE =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
const ICON_STAR =
  'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
const ICON_HOUSE = 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z';

function icon(path: string, size: number, color: string) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d={path} />
    </svg>
  );
}

export async function renderFlyer({
  property,
  options,
  currency,
  background,
}: {
  property: FlyerPropertyFields;
  options: FlyerOptions;
  currency: string;
  background: string | null;
}): Promise<Response> {
  const fonts = await loadFlyerFonts();
  const size = options.size;
  const s = (n: number) => (n * size) / 1080;

  const priceLabel =
    typeof property.price === 'number' && property.price > 0
      ? formatFlyerPrice(property.price, currency)
      : null;
  const showPrice = options.showPrice && priceLabel !== null;
  const showLocation = options.showLocation && Boolean(property.location);
  const categoryText = (property.type || 'Property').toUpperCase();

  const locationRow = (fontSize: number, color: string, weight: 400 | 700 | 800) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: s(10),
      }}
    >
      {icon(ICON_PIN, s(fontSize + 4), color)}
      <span
        style={{ color, fontSize: s(fontSize), fontWeight: weight, lineClamp: 1 }}
      >
        {property.location}
      </span>
    </div>
  );

  let overlay = null;
  if (options.template === 'minimalist') {
    overlay = (
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: size, height: size }}>
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: size,
            height: s(360),
            backgroundImage:
              'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(2,6,23,0.85) 40%, rgba(2,6,23,0.98) 100%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: s(48),
            right: s(48),
            bottom: options.showBranding ? s(122) : s(56),
            flexDirection: 'column',
            gap: s(20),
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: s(40),
            }}
          >
            <span
              style={{
                flex: 1,
                color: '#ffffff',
                fontSize: s(44),
                fontWeight: 700,
                lineHeight: 1.15,
                lineClamp: 2,
              }}
            >
              {property.title}
            </span>
            {showPrice ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  height: s(80),
                  paddingLeft: s(20),
                  paddingRight: s(20),
                  backgroundColor: '#10b981',
                  borderRadius: s(16),
                }}
              >
                <span style={{ color: '#ffffff', fontSize: s(48), fontWeight: 700 }}>
                  {priceLabel}
                </span>
              </div>
            ) : null}
          </div>
          {showLocation ? locationRow(28, '#94a3b8', 700) : null}
        </div>
        {options.showBranding ? (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: size,
              height: s(90),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: s(48),
              paddingRight: s(48),
              backgroundColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <span style={{ color: '#38bdf8', fontSize: s(24), fontWeight: 700, lineClamp: 1 }}>
              {options.brandName}
            </span>
            {options.brandContact ? (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s(10) }}>
                {icon(ICON_PHONE, s(26), '#f8fafc')}
                <span style={{ color: '#f8fafc', fontSize: s(24), fontWeight: 700 }}>
                  {options.brandContact}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  } else if (options.template === 'glassmorphism') {
    overlay = (
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: s(48),
          right: s(48),
          bottom: s(48),
          height: s(250),
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: s(36),
          backgroundColor: 'rgba(15,23,42,0.88)',
          border: `${s(2)}px solid rgba(255,255,255,0.18)`,
          borderRadius: s(24),
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: s(36),
          }}
        >
          <span
            style={{
              flex: 1,
              color: '#ffffff',
              fontSize: s(42),
              fontWeight: 700,
              lineHeight: 1.15,
              lineClamp: 2,
            }}
          >
            {property.title}
          </span>
          {showPrice ? (
            <span
              style={{ flexShrink: 0, color: '#34d399', fontSize: s(44), fontWeight: 700 }}
            >
              {priceLabel}
            </span>
          ) : null}
        </div>
        {showLocation ? locationRow(24, '#cbd5e1', 400) : null}
        {options.showBranding ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: `${s(1)}px solid rgba(255,255,255,0.1)`,
              paddingTop: s(20),
            }}
          >
            <span style={{ color: '#a5b4fc', fontSize: s(22), fontWeight: 700, lineClamp: 1 }}>
              {options.brandName}
            </span>
            {options.brandContact ? (
              <span style={{ color: '#ffffff', fontSize: s(22), fontWeight: 700 }}>
                {`Contact: ${options.brandContact}`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  } else {
    overlay = (
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: size, height: size }}>
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            backgroundImage:
              'radial-gradient(circle at 50% 50%, rgba(2,6,23,0.1) 0%, rgba(2,6,23,0.7) 60%, rgba(2,6,23,0.95) 100%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: s(32),
            left: s(32),
            width: size - s(64),
            height: size - s(64),
            border: `${s(4)}px solid rgba(217,119,6,0.3)`,
          }}
        />
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: s(160),
            left: s(80),
            width: size - s(160),
            height: size - s(380),
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: s(46),
          }}
        >
          <span
            style={{
              color: '#ffffff',
              fontSize: s(48),
              fontWeight: 700,
              lineHeight: 1.2,
              textAlign: 'center',
              lineClamp: 2,
            }}
          >
            {property.title}
          </span>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s(20) }}>
            {icon(ICON_STAR, s(28), '#fbbf24')}
            <span
              style={{ color: '#fbbf24', fontSize: s(28), fontWeight: 700, letterSpacing: s(4) }}
            >
              {categoryText}
            </span>
            {icon(ICON_STAR, s(28), '#fbbf24')}
          </div>
          {showPrice ? (
            <span style={{ color: '#ffffff', fontSize: s(68), fontWeight: 800 }}>
              {priceLabel}
            </span>
          ) : null}
          {showLocation ? locationRow(28, '#cbd5e1', 400) : null}
        </div>
        {options.showBranding ? (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              left: s(80),
              bottom: s(64),
              width: size - s(160),
              flexDirection: 'column',
              alignItems: 'center',
              gap: s(16),
            }}
          >
            <span style={{ color: '#f59e0b', fontSize: s(26), fontWeight: 700, lineClamp: 1 }}>
              {options.brandName}
            </span>
            {options.brandContact ? (
              <span style={{ color: '#ffffff', fontSize: s(24), fontWeight: 700 }}>
                {`Direct Hotline: ${options.brandContact}`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: size,
          height: size,
          backgroundColor: '#0f172a',
          fontFamily: fonts.length > 0 ? 'Inter' : undefined,
        }}
      >
        {background ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori element, not DOM
          <img
            alt=""
            src={background}
            width={size}
            height={size}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: size,
              height: size,
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              top: 0,
              left: 0,
              width: size,
              height: size,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundImage:
                'radial-gradient(circle at 50% 50%, #1e293b 0%, #020617 100%)',
            }}
          >
            {icon(ICON_HOUSE, s(320), 'rgba(255,255,255,0.05)')}
          </div>
        )}
        {overlay}
        {options.showCode && property.property_code ? (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              top: s(48),
              left: s(48),
              width: s(220),
              height: s(56),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#6366f1',
              borderRadius: s(12),
            }}
          >
            <span style={{ color: '#ffffff', fontSize: s(24), fontWeight: 700 }}>
              {property.property_code}
            </span>
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: s(48),
            right: s(48),
            height: s(56),
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: s(20),
            paddingRight: s(20),
            backgroundColor: 'rgba(15,23,42,0.85)',
            border: `${s(2)}px solid rgba(255,255,255,0.15)`,
            borderRadius: s(12),
          }}
        >
          <span style={{ color: '#38bdf8', fontSize: s(20), fontWeight: 700 }}>
            {categoryText}
          </span>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      fonts: fonts.length > 0 ? fonts : undefined,
    }
  );
}
