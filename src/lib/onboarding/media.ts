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
 * One entry per slot. Captions are written ahead of the recordings, so
 * publishing a video is replacing a single `null` with its URL — and
 * doubles as the brief for what that video should cover.
 *
 * Note the caption only appears under a player: a slot with no video
 * yet shows its illustration alone (or nothing, where the surface has
 * no illustration), never a caption on its own.
 */
export const ONBOARDING_MEDIA: Record<OnboardingMediaSlug, OnboardingMedia> = {
  'engine-welcome': {
    videoUrl: null,
    caption:
      'How enquiries, listings and follow-ups all run through one WhatsApp number.',
  },
  'engine-connect-whatsapp': {
    videoUrl: null,
    caption:
      'Why WhatsApp needs a Business number, and the two ways to get one connected.',
  },
  'engine-templates': {
    videoUrl: null,
    caption:
      'Why Meta reviews your templates, and what sending opens up once they are approved.',
  },
  'engine-add-property': {
    videoUrl: null,
    caption:
      'Forwarding a listing to your number and confirming the draft the AI builds from it.',
  },
  'engine-import-buyers': {
    videoUrl: null,
    caption:
      'Exporting your contacts from a phone or Excel sheet, and running the import.',
  },
  'engine-email-leads': {
    videoUrl: null,
    caption:
      'Setting the forwarding rule in Gmail, including the confirmation code step.',
  },
  'engine-share-seats': {
    videoUrl: null,
    caption:
      'What a beta seat gives another consultant, and how to hand one over.',
  },
  'wa-setup-overview': {
    videoUrl: null,
    caption:
      'What the whole Meta setup involves, so you know what you are starting.',
  },
  'wa-setup-concierge': {
    videoUrl: null,
    caption: 'What our team sets up for you, and what we need from you first.',
  },
  'wa-setup-portfolio': {
    videoUrl: null,
    caption: 'Creating your Meta Business Portfolio, screen by screen.',
  },
  'wa-setup-app': {
    videoUrl: null,
    caption: 'Creating the Meta app and adding WhatsApp to it.',
  },
  'wa-setup-number': {
    videoUrl: null,
    caption:
      'Adding your number, verifying it, and setting the two-step PIN you will need later.',
  },
  'wa-setup-token': {
    videoUrl: null,
    caption:
      'Creating a system user and generating a token that does not expire.',
  },
  'wa-setup-credentials': {
    videoUrl: null,
    caption: 'Where each value sits in Meta, and which box it belongs in here.',
  },
  'wa-setup-webhook': {
    videoUrl: null,
    caption:
      'Checking that Meta is really delivering messages, and what to do if it is not.',
  },
  'den-welcome': {
    videoUrl: null,
    caption:
      'What you can see about your property here, and what stays private.',
  },
  'buyer-welcome': {
    videoUrl: null,
    caption: 'Setting your preferences so matching properties come to you.',
  },
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
