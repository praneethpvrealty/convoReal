// Personal showcase design — which design an agent's own links open in.
// Port of the web's src/lib/showcase/style.ts resolver and the profile
// form's pick rules (src/components/settings/profile-form.tsx), so the
// phone and the desktop agree on when an agent follows the company
// design (PRP-021). Ported rather than imported: `@shared/` resolves
// types only here. src/lib/mobile-parity.test.ts pins the copies.

export const SHOWCASE_STYLES = [
  'spotlight',
  'editorial',
  'gallery',
  'signature',
  'warm-editorial',
  'map-discovery',
  'quiet-luxury',
  'deal-floor',
] as const;

export type ShowcaseStyle = (typeof SHOWCASE_STYLES)[number];

export const DEFAULT_SHOWCASE_STYLE: ShowcaseStyle = 'gallery';

export function toShowcaseStyle(value: unknown): ShowcaseStyle {
  return typeof value === 'string' &&
    SHOWCASE_STYLES.includes(value as ShowcaseStyle)
    ? (value as ShowcaseStyle)
    : DEFAULT_SHOWCASE_STYLE;
}

interface ShowcasePresentationSource {
  showcase_style?: unknown;
  showcase_3d_enabled?: boolean | null;
}

export function resolveShowcasePresentation(
  company: ShowcasePresentationSource | null | undefined,
  personal?: ShowcasePresentationSource | null
): { style: ShowcaseStyle; threeDimensional: boolean } {
  return {
    style: toShowcaseStyle(personal?.showcase_style ?? company?.showcase_style),
    threeDimensional:
      personal?.showcase_3d_enabled ?? company?.showcase_3d_enabled ?? true,
  };
}

export const PERSONAL_SHOWCASE_DESIGNS: ReadonlyArray<{
  value: ShowcaseStyle;
  label: string;
  detail: string;
  swatch: { background: string; accent: string } | null;
}> = [
  {
    value: 'warm-editorial',
    label: 'Warm editorial',
    detail: 'Ivory, forest green and large photos',
    swatch: { background: '#f7f5ef', accent: '#244b3b' },
  },
  {
    value: 'map-discovery',
    label: 'Map-led discovery',
    detail: 'Bright listings and publicly shared map locations',
    swatch: { background: '#ffffff', accent: '#1453ff' },
  },
  {
    value: 'quiet-luxury',
    label: 'Quiet luxury',
    detail: 'Charcoal, brass and spacious property cards',
    swatch: { background: '#202420', accent: '#bea775' },
  },
  {
    value: 'deal-floor',
    label: 'Deal Floor',
    detail: 'Warm charcoal, saffron, fill-in-the-blank search and Quick Picks',
    swatch: { background: '#14120f', accent: '#ffb020' },
  },
  {
    value: 'spotlight',
    label: 'Spotlight',
    detail: 'Cinematic, photo-first listings',
    swatch: null,
  },
  {
    value: 'editorial',
    label: 'Editorial',
    detail: 'Refined magazine presentation',
    swatch: null,
  },
  {
    value: 'gallery',
    label: 'Gallery',
    detail: 'Fast, visual property browsing',
    swatch: null,
  },
  {
    value: 'signature',
    label: 'Signature',
    detail: 'Brand-led premium presentation',
    swatch: null,
  },
];

export interface PersonalShowcase {
  style: ShowcaseStyle | null;
  threeDimensional: boolean | null;
}

export const FOLLOW_COMPANY: PersonalShowcase = {
  style: null,
  threeDimensional: null,
};

export function toPersonalShowcase(
  row: ShowcasePresentationSource | null | undefined
): PersonalShowcase {
  return {
    style:
      row?.showcase_style == null ? null : toShowcaseStyle(row.showcase_style),
    threeDimensional: row?.showcase_3d_enabled ?? null,
  };
}

export function followsCompanyDesign(personal: PersonalShowcase): boolean {
  return personal.style === null && personal.threeDimensional === null;
}

export function isAgencyDesign(style: ShowcaseStyle): boolean {
  return PERSONAL_SHOWCASE_DESIGNS.some(
    (design) => design.value === style && design.swatch !== null
  );
}

export function pickPersonalDesign(
  current: PersonalShowcase,
  style: ShowcaseStyle,
  effectiveThreeDimensional: boolean
): PersonalShowcase {
  return {
    style,
    threeDimensional: isAgencyDesign(style)
      ? false
      : (current.threeDimensional ?? effectiveThreeDimensional),
  };
}

export function setPersonalThreeDimensional(
  current: PersonalShowcase,
  enabled: boolean,
  effectiveStyle: ShowcaseStyle
): PersonalShowcase {
  return { style: current.style ?? effectiveStyle, threeDimensional: enabled };
}

export function personalShowcaseChanged(
  saved: PersonalShowcase,
  next: PersonalShowcase
): boolean {
  return (
    saved.style !== next.style ||
    saved.threeDimensional !== next.threeDimensional
  );
}
