/**
 * Lead temperature values and how they read, shared at runtime by web
 * and mobile. The mobile app bundles this file through `@shared/`, so it
 * must stay free of imports.
 */

export const LEAD_TEMPS = ['HOT', 'COLD', 'Not Responding', 'Dead'] as const;

export type LeadTemp = (typeof LEAD_TEMPS)[number];

const LEAD_TEMP_EMOJI: Record<LeadTemp, string> = {
  HOT: '🔥',
  COLD: '❄️',
  'Not Responding': '⏳',
  Dead: '💀',
};

export function isLeadTemp(value: unknown): value is LeadTemp {
  return (
    typeof value === 'string' &&
    (LEAD_TEMPS as readonly string[]).includes(value)
  );
}

export function leadTempLabel(value: string | null | undefined): string | null {
  return isLeadTemp(value) ? `${LEAD_TEMP_EMOJI[value]} ${value}` : null;
}

export const LEAD_TEMP_OPTIONS: readonly { value: LeadTemp; label: string }[] =
  LEAD_TEMPS.map((value) => ({
    value,
    label: `${LEAD_TEMP_EMOJI[value]} ${value}`,
  }));

export const LEAD_TEMP_NONE_LABEL = 'None';

export const VIP_BADGE_LABEL = '⭐ VIP';

export function isVipTag(name: string | null | undefined): boolean {
  return (name ?? '').trim().toUpperCase() === 'VIP';
}
