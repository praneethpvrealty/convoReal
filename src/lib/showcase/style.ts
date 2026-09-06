export const SHOWCASE_STYLES = [
  'spotlight',
  'editorial',
  'gallery',
  'signature',
  'warm-editorial',
  'map-discovery',
  'quiet-luxury',
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
  const source = personal ?? company;
  return {
    style: toShowcaseStyle(source?.showcase_style),
    threeDimensional: source?.showcase_3d_enabled ?? true,
  };
}

export const AGENCY_SHOWCASE_DESIGNS = [
  {
    value: 'warm-editorial',
    label: 'Warm editorial',
    description: 'Ivory, forest green and generous property photography',
    background: '#f7f5ef',
    accent: '#244b3b',
    foreground: '#202820',
  },
  {
    value: 'map-discovery',
    label: 'Map-led discovery',
    description: 'Bright listings and a map of publicly shared locations',
    background: '#ffffff',
    accent: '#1453ff',
    foreground: '#152039',
  },
  {
    value: 'quiet-luxury',
    label: 'Quiet luxury',
    description: 'Warm charcoal, brass accents and spacious property cards',
    background: '#202420',
    accent: '#bea775',
    foreground: '#f7f5ef',
  },
] as const;

export function isAgencyShowcaseDesign(value: unknown): boolean {
  return AGENCY_SHOWCASE_DESIGNS.some((design) => design.value === value);
}

export function showcasePreviewUrl(url: string, style: ShowcaseStyle): string {
  const preview = new URL(url);
  preview.searchParams.set('preview_style', style);
  return preview.toString();
}
