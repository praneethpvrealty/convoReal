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
