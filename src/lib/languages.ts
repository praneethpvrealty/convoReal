// ============================================================
// The languages ConvoReal speaks to a contact in.
//
// One registry, because four separate concerns need to agree on
// the same set and would otherwise drift apart:
//   - contacts.preferred_language / accounts.default_language
//   - WhatsApp template variants (Meta keys a template on
//     (name, language), so each language is its own registration)
//   - the AI prompts that name the languages they must handle
//   - the UI locale picker
//
// Deliberately NOT the same list as NARRATION_LANGUAGES in
// src/lib/video/listing-video.ts. That one is whatever Sarvam's
// bulbul can narrate (11, including Odia); this one is what the
// product can actually hold a conversation in.
// ============================================================

export interface LanguageEntry {
  /** English name, for agent-facing UI. */
  label: string;
  /** Endonym, shown alongside the label so a native reader finds it fast. */
  native: string;
  /**
   * The code Meta registers a template under. Not always the same as
   * our key: Meta has no bare `en`, it wants a locale variant.
   */
  meta: string;
}

export const SUPPORTED_LANGUAGES = {
  en: { label: 'English', native: 'English', meta: 'en_US' },
  hi: { label: 'Hindi', native: 'हिन्दी', meta: 'hi' },
  kn: { label: 'Kannada', native: 'ಕನ್ನಡ', meta: 'kn' },
  ta: { label: 'Tamil', native: 'தமிழ்', meta: 'ta' },
  te: { label: 'Telugu', native: 'తెలుగు', meta: 'te' },
  ml: { label: 'Malayalam', native: 'മലയാളം', meta: 'ml' },
  mr: { label: 'Marathi', native: 'मराठी', meta: 'mr' },
} as const satisfies Record<string, LanguageEntry>;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/**
 * How many languages one agent may keep switchable in the app.
 *
 * A packaging number, not a technical one — the catalogue, the toggle
 * and the profile column all handle any count. Raise it here (or read
 * it off the plan) when a subscription tier should unlock more; the
 * DB constraint in migration 247 deliberately does not encode it.
 */
export const MAX_UI_LANGUAGES = 2;

export const LANGUAGE_CODES = Object.keys(SUPPORTED_LANGUAGES) as LanguageCode[];

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === 'string' && v in SUPPORTED_LANGUAGES;
}

/** Narrow an untrusted value to a code, falling back to English. */
export function toLanguageCode(v: unknown): LanguageCode {
  return isLanguageCode(v) ? v : DEFAULT_LANGUAGE;
}

export function languageLabel(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES[code].label;
}

/** "हिन्दी (Hindi)" — native first, since that's what a native reader scans for. */
export function languageDisplay(code: LanguageCode): string {
  const { label, native } = SUPPORTED_LANGUAGES[code];
  return label === native ? label : `${native} (${label})`;
}

/** The Meta template language code for a send. */
export function metaLanguageCode(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES[code].meta;
}

// ------------------------------------------------------------
// Prompt fragments
//
// Derived from the registry rather than hand-written at each call
// site. Six prompts previously carried their own list and three of
// them had silently drifted — two were missing Malayalam and
// Marathi, and the customer-facing ones named no Indian language
// at all. Adding a language to the registry now reaches them all.
// ------------------------------------------------------------

const INDIAN_LANGUAGE_LABELS = LANGUAGE_CODES.filter((c) => c !== 'en').map(
  (c) => SUPPORTED_LANGUAGES[c].label,
);

/** For prompts describing what a user may speak or type AT us. */
export const INPUT_LANGUAGE_HINT = `${INDIAN_LANGUAGE_LABELS.join(', ')} or English — often mixed, and often romanised`;

/** For prompts producing text a customer will read. */
export const REPLY_LANGUAGE_RULE =
  `Reply in the SAME language and script the reader used — ${INDIAN_LANGUAGE_LABELS.join(', ')}, ` +
  `English, or a romanised mix such as Hinglish. If they wrote in an Indian language, answer in that ` +
  `language and that script; never switch them to English.`;
