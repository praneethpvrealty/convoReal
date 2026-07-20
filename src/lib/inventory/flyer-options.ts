export const FLYER_TEMPLATES = ['minimalist', 'glassmorphism', 'vignette'] as const;
export type FlyerTemplate = (typeof FLYER_TEMPLATES)[number];

export interface FlyerOptions {
  template: FlyerTemplate;
  showPrice: boolean;
  showCode: boolean;
  showLocation: boolean;
  showBranding: boolean;
  brandName: string;
  brandContact: string;
  imageSource: 'original' | 'ai';
  aiImage: string | null;
  size: 540 | 1080;
  save: boolean;
}

const AI_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
const AI_IMAGE_MAX_LENGTH = 12_000_000;

export function parseFlyerOptions(
  body: unknown
): { options: FlyerOptions } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' };
  }
  const b = body as Record<string, unknown>;

  const template = FLYER_TEMPLATES.includes(b.template as FlyerTemplate)
    ? (b.template as FlyerTemplate)
    : 'minimalist';

  const bool = (v: unknown, fallback: boolean) =>
    typeof v === 'boolean' ? v : fallback;
  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  let aiImage: string | null = null;
  if (typeof b.ai_image === 'string' && b.ai_image.length > 0) {
    if (b.ai_image.length > AI_IMAGE_MAX_LENGTH) {
      return { error: "'ai_image' is too large" };
    }
    // Only inline data URLs or this project's own public storage — the
    // URL is fetched server-side by satori, so arbitrary hosts would be
    // an SSRF vector.
    const storagePrefix = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/`
      : null;
    if (AI_IMAGE_PATTERN.test(b.ai_image)) {
      aiImage = b.ai_image;
    } else if (storagePrefix && b.ai_image.startsWith(storagePrefix)) {
      aiImage = b.ai_image;
    } else {
      return {
        error: "'ai_image' must be a base64 image data URL or a storage public URL",
      };
    }
  }

  const imageSource = b.image_source === 'ai' ? 'ai' : 'original';
  if (imageSource === 'ai' && !aiImage) {
    return { error: "'ai_image' is required when image_source is 'ai'" };
  }

  const save = b.save === true;

  return {
    options: {
      template,
      showPrice: bool(b.show_price, true),
      showCode: bool(b.show_code, true),
      showLocation: bool(b.show_location, true),
      showBranding: bool(b.show_branding, true),
      brandName: str(b.brand_name, 60),
      brandContact: str(b.brand_contact, 40),
      imageSource,
      aiImage,
      size: save || b.size === 1080 ? 1080 : 540,
      save,
    },
  };
}

export function formatFlyerPrice(amount: number, currency: string): string {
  if (currency === 'INR') {
    if (amount >= 10000000) {
      const cr = amount / 10000000;
      return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
    }
    if (amount >= 100000) {
      const lakhs = amount / 100000;
      return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
