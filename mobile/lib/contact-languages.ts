// ------------------------------------------------------------------
// The languages ConvoReal speaks to a contact in, mirrored by hand from
// src/lib/languages.ts the way every mobile mirror is (mobile cannot
// import runtime values from src/). The web repo's
// src/lib/mobile-parity.test.ts fails CI when the two drift.
//
// NOT named `languages.ts`: tsconfig maps `@/*` to the mobile root and
// then to ../src, so a mobile module sitting at a path a web module in
// this program imports as `@/<path>` silently shadows it. `lib/languages`
// did exactly that to src/lib/languages, and the web WhatsApp templates
// failed to find exports they import. See the note in tsconfig.json; the
// no-overlap rule is enforced by the alias-shadowing tests on both sides.
//
// Pure data + functions — no Expo or React Native imports — so this
// stays testable under the plain Node vitest runner.
// ------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = {
  en: { label: 'English', native: 'English' },
  hi: { label: 'Hindi', native: 'हिन्दी' },
  kn: { label: 'Kannada', native: 'ಕನ್ನಡ' },
  ta: { label: 'Tamil', native: 'தமிழ்' },
  te: { label: 'Telugu', native: 'తెలుగు' },
  ml: { label: 'Malayalam', native: 'മലയാളം' },
  mr: { label: 'Marathi', native: 'मराठी' },
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const LANGUAGE_CODES = Object.keys(
  SUPPORTED_LANGUAGES
) as LanguageCode[];

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === 'string' && v in SUPPORTED_LANGUAGES;
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
