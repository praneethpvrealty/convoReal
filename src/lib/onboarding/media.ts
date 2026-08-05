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
  | 'engine-templates'
  | 'engine-add-property'
  | 'engine-import-buyers'
  | 'engine-email-leads'
  | 'engine-share-seats'
  | 'wa-setup-overview'
  | 'wa-setup-concierge'
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

/**
 * Every slot, with what its video should cover — this doubles as the
 * shot list. A slot whose surface has no illustration behind it renders
 * nothing at all until a URL lands here, so an unrecorded video is
 * invisible rather than a broken frame.
 *
 *   engine-welcome           What ConvoReal is, end to end (the 2-min pitch)
 *   engine-connect-whatsapp  Why a Business number, and the two paths to one
 *   engine-templates         Draft → submit → approved, and what that unlocks
 *   engine-add-property      Forwarding a listing and confirming the AI draft
 *   engine-import-buyers     Exporting contacts and running the CSV import
 *   engine-email-leads       Setting the Gmail rule and the verification catch
 *   engine-share-seats       What a beta seat is and how to hand one over
 *   wa-setup-overview        What the whole Meta setup involves, before starting
 *   wa-setup-concierge       What our team does for you on the setup call
 *   wa-setup-*               One per Meta console screen, click by click
 *   den-welcome              What the owner Portfolio shows, and why it's safe
 *   buyer-welcome            How buyer preferences turn into matches
 */
export const ONBOARDING_MEDIA: Record<OnboardingMediaSlug, OnboardingMedia> = {
  'engine-welcome': NONE,
  'engine-connect-whatsapp': NONE,
  'engine-templates': NONE,
  'engine-add-property': NONE,
  'engine-import-buyers': NONE,
  'engine-email-leads': NONE,
  'engine-share-seats': NONE,
  'wa-setup-overview': NONE,
  'wa-setup-concierge': NONE,
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
