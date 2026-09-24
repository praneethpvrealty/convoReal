// ------------------------------------------------------------------
// The languages ConvoReal speaks to a contact in, mirrored by hand from
// src/lib/languages.ts the way every mobile mirror is (mobile cannot
// import runtime values from src/). The web repo's
// src/lib/mobile-parity.test.ts fails CI when the two drift.
//
// Pure data + functions — no Expo or React Native imports — so this
// stays testable under the plain Node vitest runner.
// ------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = {
  en: { label: 'English', native: 'English', meta: 'en_US' },
  hi: { label: 'Hindi', native: 'हिन्दी', meta: 'hi' },
  kn: { label: 'Kannada', native: 'ಕನ್ನಡ', meta: 'kn' },
  ta: { label: 'Tamil', native: 'தமிழ்', meta: 'ta' },
  te: { label: 'Telugu', native: 'తెలుగు', meta: 'te' },
  ml: { label: 'Malayalam', native: 'മലയാളം', meta: 'ml' },
  mr: { label: 'Marathi', native: 'मराठी', meta: 'mr' },
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const LANGUAGE_CODES = Object.keys(
  SUPPORTED_LANGUAGES
) as LanguageCode[];

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === 'string' && v in SUPPORTED_LANGUAGES;
}

export function toLanguageCode(v: unknown): LanguageCode {
  return isLanguageCode(v) ? v : DEFAULT_LANGUAGE;
}

/** The code Meta registers a template under — not always our key,
 *  since Meta has no bare `en`. */
export function metaLanguageCode(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES[code].meta;
}

/** "हिन्दी (Hindi)" — native first, since that's what a native reader scans for. */
export function languageDisplay(code: LanguageCode): string {
  const { label, native } = SUPPORTED_LANGUAGES[code];
  return label === native ? label : `${native} (${label})`;
}

/** The picker row that means "no preference — follow the account default". */
export const FOLLOW_ACCOUNT_DEFAULT_LABEL = 'Follow account default';

export function languageFromDisplay(display: string): LanguageCode | null {
  return LANGUAGE_CODES.find((c) => languageDisplay(c) === display) ?? null;
}
