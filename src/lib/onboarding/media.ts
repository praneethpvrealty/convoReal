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
 * A caption annotates whichever figure is showing, illustration or
 * video, so write it about the subject rather than the medium: it has
 * to still read correctly after the swap. It says what the figure
 * shows, never what the step's body copy already said. Slots with no
 * illustration behind them stay silent until their video lands.
 */
export const ONBOARDING_MEDIA: Record<OnboardingMediaSlug, OnboardingMedia> = {
  'engine-welcome': {
    videoUrl: null,
    caption: 'An enquiry arrives, and the lead is saved before you type.',
  },
  'engine-connect-whatsapp': {
    videoUrl: null,
    caption: 'Once connected, every message to your number lands here.',
  },
  'engine-templates': {
    videoUrl: null,
    caption: 'One approval per template, then it sends on its own.',
  },
  'engine-add-property': {
    videoUrl: null,
    caption: 'The message you forward, and the listing built from it.',
  },
  'engine-import-buyers': {
    videoUrl: null,
    caption: 'Your existing list, matched against your inventory.',
  },
  'engine-email-leads': {
    videoUrl: null,
    caption: 'A portal enquiry, turned into a contact and greeted for you.',
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
    caption: 'The three details Meta asks for.',
  },
  'wa-setup-app': {
    videoUrl: null,
    caption: 'The choices that create your app and tie it to the portfolio.',
  },
  'wa-setup-number': {
    videoUrl: null,
    caption: 'Your number, and the two IDs you copy in step 5.',
  },
  'wa-setup-token': {
    videoUrl: null,
    caption: 'The settings that make the token permanent.',
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
