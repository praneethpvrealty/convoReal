// ============================================================
// Listing derivations — deterministic measurement and pricing
// maths applied to an intake draft after the model has had its
// pass. Covers the two things the model reliably drops during
// WhatsApp intake, where details arrive one message at a time:
//   • a plot quoted as "Size - 60*40" never becoming a land area
//   • a rate quoted "10500 per sqft" never becoming a total price
//     once the area finally arrives, two messages later
// Pure functions, no network.
// ============================================================

import type { ParsedPropertyDraft } from '@/lib/ai/gemini';
import { canonicalAreaUnit, toSquareFeet } from '@/lib/area-units';
import { rentalYieldPercent } from '@/lib/inventory/rental-yield';

export { canonicalAreaUnit, toSquareFeet };

const AMOUNT_MULTIPLIER: Record<string, number> = {
  cr: 1_00_00_000,
  crore: 1_00_00_000,
  crores: 1_00_00_000,
  lakh: 1_00_000,
  lakhs: 1_00_000,
  lac: 1_00_000,
  lacs: 1_00_000,
  l: 1_00_000,
  k: 1_000,
};

const UNIT_PATTERN =
  'sq\\.?\\s*ft\\.?|sqft|sq\\.?\\s*feet|sq\\.?\\s*yards?|sq\\.?\\s*yds?|sq\\.?\\s*m(?:tr|eter|etre)?s?\\.?|acres?|gunt(?:h)?as?|cents?|grounds?';

const RATE_RE = new RegExp(
  `(?:₹|rs\\.?|inr)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(cr|crores?|lakhs?|lacs?|l|k)?\\s*(?:\\/|per\\s+)\\s*(${UNIT_PATTERN})`,
  'i'
);

const PER_MONTH_RE = /^[\s.,)]*(?:per\s*month|\/\s*month|p\.?m\.?\b|monthly)/i;

/** "60*40", "60 x 40 ft", "60×40" → the two sides in feet. Rejects a
 *  third factor ("30x40x50", an irregular plot) rather than guessing. */
const DIMENSION_RE = /(\d{1,5}(?:\.\d+)?)\s*(?:ft\.?|feet|')?\s*[x×*]\s*(\d{1,5}(?:\.\d+)?)\s*(?:ft\.?|feet|')?(?!\s*[x×*])/i;

const MIN_DIMENSION_FT = 5;
const MAX_DIMENSION_FT = 10_000;

/** "60*40" → 2400 Sq.Ft. */
export function parseDimensionsToSqft(dimensions: string | null | undefined): number | null {
  if (!dimensions) return null;
  const match = dimensions.match(DIMENSION_RE);
  if (!match) return null;
  const length = parseFloat(match[1]);
  const width = parseFloat(match[2]);
  if (!Number.isFinite(length) || !Number.isFinite(width)) return null;
  if (length < MIN_DIMENSION_FT || width < MIN_DIMENSION_FT) return null;
  if (length > MAX_DIMENSION_FT || width > MAX_DIMENSION_FT) return null;
  return Math.round(length * width);
}

/** Backstop for when the model leaves `dimensions` null on a message
 *  that plainly carries one ("Size - 60*40"). */
export function extractDimensionsFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(DIMENSION_RE);
  if (!match) return null;
  const normalized = `${match[1]}x${match[2]}`;
  return parseDimensionsToSqft(normalized) ? normalized : null;
}

export interface RateQuote {
  /** Rate normalized to rupees per Sq.Ft. */
  perSqft: number;
  /** The amount as quoted, before the per-unit conversion — used to spot
   *  a model that filed the rate as the total price. */
  amount: number;
}

/** "Price - 10500 per sqft" → { perSqft: 10500, amount: 10500 };
 *  "1.2 Cr per acre" → { perSqft: 275.48, amount: 12000000 }.
 *  Rental rates ("₹85 per sqft per month") are deliberately ignored. */
export function extractRateQuote(text: string | null | undefined): RateQuote | null {
  if (!text) return null;
  const normalized = text.replace(/\bp\.?s\.?f\.?\b/gi, 'per sqft');
  const match = normalized.match(RATE_RE);
  if (!match || match.index === undefined) return null;

  const trailing = normalized.slice(match.index + match[0].length);
  if (PER_MONTH_RE.test(trailing)) return null;

  const base = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unitKey = canonicalAreaUnit(match[3]);
  if (!unitKey) return null;

  const amount = base * (match[2] ? AMOUNT_MULTIPLIER[match[2].toLowerCase()] ?? 1 : 1);
  const sqftPerUnit = toSquareFeet(1, unitKey);
  if (!sqftPerUnit) return null;
  const perSqft = amount / sqftPerUnit;
  if (!Number.isFinite(perSqft) || perSqft <= 0) return null;

  return { perSqft, amount };
}

const YOUTUBE_URL_RE =
  /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S+/i;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

/** A listing video often arrives as a YouTube link pasted into the
 *  message rather than a forwarded MP4. The model has no field for it,
 *  so the ID is lifted deterministically here. Trailing punctuation is
 *  stripped — "…youtu.be/abc123XYZ_-." ends a sentence, not an ID. */
export function extractYouTubeVideoId(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(YOUTUBE_URL_RE);
  if (!match) return null;

  let parsed: URL;
  try {
    parsed = new URL(match[0].replace(/[.,!?)\]}>]+$/, ''));
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^(?:www|m)\./, '');
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') {
    const id = parsed.searchParams.get('v') || '';
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
    return YOUTUBE_ID_RE.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

/** Abbreviations, upper-case only so an ordinary word never trips them.
 *  The negative lookahead keeps a name out of it — "JD Tower" is a
 *  building, "apartment JD" and "JD basis" are deals. */
const JOINT_DEVELOPMENT_ABBR_RE = /\b(?:JD|JV)\b(?!\s+[A-Z][a-z])/;
const JOINT_DEVELOPMENT_PHRASE_RE = /\bjoint\s*(?:development|venture)\b/i;

/** A JD offer reaches us as prose — "12 acres available for an apartment
 *  JD" — and the model still files it as a sale with a missing price,
 *  which is the one thing a joint development will never have. */
export function detectJointDevelopment(text: string | null | undefined): boolean {
  if (!text) return false;
  return JOINT_DEVELOPMENT_ABBR_RE.test(text) || JOINT_DEVELOPMENT_PHRASE_RE.test(text);
}

function normalizeJvStructure(raw: unknown): ParsedPropertyDraft['jv_structure'] {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  if (lower.includes('revenue')) return 'Revenue Share';
  if (lower.includes('area')) return 'Area Share';
  if (lower.includes('hybrid')) return 'Hybrid';
  return null;
}

function normalizeSharePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value;
}

function isLandOrPlot(type: ParsedPropertyDraft['type']): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return lower.includes('land') || lower.includes('plot');
}

/** The area a per-Sq.Ft. rate applies to: the site for land/plots, the
 *  built-up area for everything else, falling back to whichever is known. */
function priceableAreaSqft(draft: ParsedPropertyDraft): number | null {
  const landSqft = toSquareFeet(draft.land_area, draft.land_area_unit);
  const builtUpSqft = draft.area_sqft && draft.area_sqft > 0 ? draft.area_sqft : null;
  return isLandOrPlot(draft.type) ? landSqft ?? builtUpSqft : builtUpSqft ?? landSqft;
}

/**
 * Applies the deterministic derivations to a freshly parsed or updated
 * draft. `rawText` is the message that produced it (used as a backstop
 * when the model missed a dimension or a rate); `previousDraft` is the
 * draft before this update, which is how a total price the user states
 * outright is told apart from one this function computed earlier.
 */
export function applyListingDerivations(
  draft: ParsedPropertyDraft,
  rawText?: string | null,
  previousDraft?: ParsedPropertyDraft | null
): ParsedPropertyDraft {
  const next: ParsedPropertyDraft = { ...draft };

  if (!next.dimensions) {
    next.dimensions = extractDimensionsFromText(rawText);
  }

  // A fresh link replaces the previous one — a listing carries ONE
  // video, same as properties.video_url.
  next.youtube_video_id =
    extractYouTubeVideoId(rawText) ??
    next.youtube_video_id ??
    previousDraft?.youtube_video_id ??
    null;

  const dimensionSqft = parseDimensionsToSqft(next.dimensions);
  if (dimensionSqft && !next.land_area) {
    next.land_area = dimensionSqft;
    next.land_area_unit = 'Sq.Ft.';
  }

  const quote = extractRateQuote(rawText);
  if (quote) {
    next.price_per_sqft = quote.perSqft;
    if (next.price && Math.round(next.price) === Math.round(quote.amount)) {
      next.price = null;
      next.price_from_rate = true;
    }
  } else if (previousDraft && next.price && next.price !== previousDraft.price) {
    next.price_from_rate = false;
  }

  // The title is only consulted on the first parse: on a correction the
  // model's own reading of the new message wins, so a lister who says
  // "actually it's for sale at 1.2 Cr" can get back out of JV/JD.
  const jointDevelopment =
    next.listing_type === 'JV/JD' ||
    (next.listing_type !== 'Rent' &&
      (detectJointDevelopment(rawText) || (!previousDraft && detectJointDevelopment(next.title))));

  if (next.price_per_sqft && next.listing_type !== 'Rent' && !jointDevelopment) {
    const areaSqft = priceableAreaSqft(next);
    if (areaSqft && (!next.price || next.price_from_rate)) {
      next.price = Math.round(next.price_per_sqft * areaSqft);
      next.price_from_rate = true;
    }
  }

  if (jointDevelopment) {
    next.listing_type = 'JV/JD';
    next.jv_structure = normalizeJvStructure(next.jv_structure);
    const owner = normalizeSharePercent(next.owner_share_percent);
    const builder = normalizeSharePercent(next.builder_share_percent);
    next.owner_share_percent = owner ?? (builder !== null ? 100 - builder : null);
    next.builder_share_percent = builder ?? (owner !== null ? 100 - owner : null);
    // "Goodwill and advance 2.5 Cr per acre" is a rate on the deal, not
    // on the land. Multiplying it by the site gives the goodwill total
    // over again, not a project value — that is FAR × the selling price
    // of what gets built, which no intake message carries. So a price
    // this function derived is withdrawn, and only a figure the lister
    // stated outright survives as the expected project value.
    next.price_per_sqft = null;
    if (next.price_from_rate) {
      next.price = null;
      next.price_from_rate = false;
    }
  }

  // Last, so it reads the price this function settled on rather than the
  // one the model guessed — and so a draft that turned out to be a
  // rental loses the yield the previous pass gave it.
  next.roi = rentalYieldPercent(next.listing_type, next.price, next.rental_income);

  return next;
}
