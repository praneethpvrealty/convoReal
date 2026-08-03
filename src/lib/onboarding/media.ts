// ============================================================
// Onboarding media registry.
//
// Every hand-holding step in the product (consultant wizard, the
// WhatsApp guided setup, the owner/buyer Portfolio welcomes) renders
// an illustration by default. When a walkthrough video is recorded,
// drop its URL into this registry against the step's slug and that
// step upgrades itself to a video player — no component changes.
//
// Keeping this as plain data means the slugs are unit-testable and
// the video rollout is a one-line diff per step.
// ============================================================

export type OnboardingMediaSlug =
  | 'engine-welcome'
  | 'engine-connect-whatsapp'
  | 'engine-add-property'
  | 'engine-first-lead'
  | 'wa-setup-overview'
  | 'wa-setup-portfolio'
  | 'wa-setup-app'
  | 'wa-setup-number'
  | 'wa-setup-token'
  | 'wa-setup-credentials'
  | 'wa-setup-webhook'
  | 'den-welcome'
  | 'buyer-welcome';

export interface OnboardingMedia {
  /** YouTube watch/short/embed URL, or null while unrecorded. */
  videoUrl: string | null;
  /** Short line shown under the player. */
  caption: string | null;
}

const NONE: OnboardingMedia = { videoUrl: null, caption: null };

export const ONBOARDING_MEDIA: Record<OnboardingMediaSlug, OnboardingMedia> = {
  'engine-welcome': NONE,
  'engine-connect-whatsapp': NONE,
  'engine-add-property': NONE,
  'engine-first-lead': NONE,
  'wa-setup-overview': NONE,
  'wa-setup-portfolio': NONE,
  'wa-setup-app': NONE,
  'wa-setup-number': NONE,
  'wa-setup-token': NONE,
  'wa-setup-credentials': NONE,
  'wa-setup-webhook': NONE,
  'den-welcome': NONE,
  'buyer-welcome': NONE,
};

export function getOnboardingMedia(slug: OnboardingMediaSlug): OnboardingMedia {
  return ONBOARDING_MEDIA[slug] ?? NONE;
}

/**
 * Normalise a YouTube URL to its embeddable form. Returns null for
 * anything that isn't a recognisable YouTube link so a typo'd registry
 * entry falls back to the illustration instead of a broken iframe.
 */
export function toEmbedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.replace(/^www\./, '');
  const idRe = /^[A-Za-z0-9_-]{6,20}$/;

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return idRe.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') {
      const id = parsed.searchParams.get('v') || '';
      return idRe.test(id) ? `https://www.youtube.com/embed/${id}` : null;
    }
    if ((parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) {
      return idRe.test(parts[1])
        ? `https://www.youtube.com/embed/${parts[1]}`
        : null;
    }
  }

  return null;
}
