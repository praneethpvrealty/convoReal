// ============================================================
// Listing-video shared logic — CLIENT-SAFE (no node imports).
// The ffmpeg/Sarvam render lives in listing-video-worker.ts.
// ============================================================

/** BCP-47 codes Sarvam bulbul narrates; drives the UI picker. */
export const NARRATION_LANGUAGES = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी (Hindi)',
  'kn-IN': 'ಕನ್ನಡ (Kannada)',
  'ta-IN': 'தமிழ் (Tamil)',
  'te-IN': 'తెలుగు (Telugu)',
  'ml-IN': 'മലയാളം (Malayalam)',
  'mr-IN': 'मराठी (Marathi)',
  'bn-IN': 'বাংলা (Bengali)',
  'gu-IN': 'ગુજરાતી (Gujarati)',
  'pa-IN': 'ਪੰਜਾਬੀ (Punjabi)',
  'od-IN': 'ଓଡ଼ିଆ (Odia)',
} as const;

export type NarrationLanguage = keyof typeof NARRATION_LANGUAGES;

export function isNarrationLanguage(v: unknown): v is NarrationLanguage {
  return typeof v === 'string' && v in NARRATION_LANGUAGES;
}

/** The property fields the narration/caption builders read. */
export interface VideoPropertyFacts {
  title?: string | null;
  type?: string | null;
  bedrooms?: number | null;
  city?: string | null;
  sublocality?: string | null;
  location?: string | null;
  price?: number | string | null;
  rent_per_month?: number | string | null;
  listing_type?: string | null;
}

export function formatIndianAmount(value: number): string {
  if (value >= 10000000) return `${(value / 10000000).toFixed(2).replace(/\.?0+$/, '')} crore rupees`;
  if (value >= 100000) return `${(value / 100000).toFixed(2).replace(/\.?0+$/, '')} lakh rupees`;
  return `${Math.round(value).toLocaleString('en-IN')} rupees`;
}

/**
 * Deterministic English narration script (~60-80 words) from the
 * property record. Template-based rather than LLM for v1 — free,
 * instant, and never hallucinates a fact that isn't on the listing.
 * Regional languages go through Sarvam translate on the worker.
 */
export function buildNarrationScript(p: VideoPropertyFacts): string {
  const locality = [p.sublocality, p.city].filter(Boolean).join(', ') || p.location || '';
  const what = [
    p.bedrooms && p.bedrooms > 0 ? `${p.bedrooms} bedroom` : '',
    (p.type || 'property').toLowerCase().replace('/ ', ' '),
  ].filter(Boolean).join(' ');
  const price = Number(p.price);
  const rent = Number(p.rent_per_month);
  const priceLine =
    p.listing_type === 'Rent' && Number.isFinite(rent) && rent > 0
      ? `Monthly rent ${formatIndianAmount(rent)}.`
      : Number.isFinite(price) && price > 0
        ? `Priced at ${formatIndianAmount(price)}.`
        : '';
  return [
    `Presenting ${p.title || `this ${what}`}${locality ? `, in ${locality}` : ''}.`,
    `A well maintained ${what}, ready for you to see in person.`,
    priceLine,
    'Message us on WhatsApp to get the full details, photos, and to book your site visit today.',
  ].filter(Boolean).join(' ');
}

/** Caption for photo N of the slideshow. First is the headline;
 *  later ones rotate through generic-but-true labels. */
export function buildCaptions(p: VideoPropertyFacts, photoCount: number): string[] {
  const locality = [p.sublocality, p.city].filter(Boolean).join(', ') || p.location || '';
  const rotating = [
    locality ? `In ${locality}` : 'Prime location',
    p.bedrooms && p.bedrooms > 0 ? `${p.bedrooms} BHK ${p.type ?? ''}`.trim() : (p.type ?? 'Quality build'),
    'Tap for photos & full details',
    'Site visits available this week',
  ];
  const captions: string[] = [];
  for (let i = 0; i < photoCount; i++) {
    captions.push(i === 0 ? (p.title || 'New listing').slice(0, 48) : rotating[(i - 1) % rotating.length]);
  }
  return captions;
}
