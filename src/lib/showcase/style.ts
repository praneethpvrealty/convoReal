export const SHOWCASE_STYLES = [
  'spotlight',
  'editorial',
  'gallery',
  'signature',
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
