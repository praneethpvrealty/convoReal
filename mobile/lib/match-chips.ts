import type { MatchDetails, MatchVerdict } from '@shared/lib/matching';

/**
 * Web parity: src/components/inventory/match-detail-chips.tsx. Same
 * labels in the same order, so one match reads identically on both
 * surfaces; only the colour vocabulary is mapped to the native theme.
 */
export type MatchChipTone =
  | 'type'
  | 'location'
  | 'positive'
  | 'warn'
  | 'negative'
  | 'muted';

export interface MatchChip {
  label: string;
  tone: MatchChipTone;
}

type ChipsByVerdict = Partial<Record<MatchVerdict, MatchChip>>;

const TYPE_CHIPS: ChipsByVerdict = {
  match: { label: 'Type match', tone: 'type' },
  partial: { label: 'Category match', tone: 'type' },
  unknown: { label: 'No type preference', tone: 'muted' },
};

const LOCATION_CHIPS: ChipsByVerdict = {
  match: { label: 'Location match', tone: 'location' },
  partial: { label: 'Same city', tone: 'location' },
  unknown: { label: 'No location preference', tone: 'muted' },
};

const BUDGET_CHIPS: ChipsByVerdict = {
  match: { label: 'Budget fit', tone: 'positive' },
  partial: { label: 'Budget flexible', tone: 'warn' },
  unknown: { label: 'No budget on file', tone: 'muted' },
};

const BHK_CHIPS: ChipsByVerdict = {
  match: { label: 'BHK fit', tone: 'positive' },
  mismatch: { label: 'BHK differs', tone: 'negative' },
};

const ROI_CHIPS: ChipsByVerdict = {
  match: { label: 'ROI met', tone: 'positive' },
};

export function matchChips(details: MatchDetails): MatchChip[] {
  return [
    TYPE_CHIPS[details.type],
    LOCATION_CHIPS[details.location],
    BUDGET_CHIPS[details.budget],
    BHK_CHIPS[details.bhk],
    ROI_CHIPS[details.roi],
  ].filter((chip): chip is MatchChip => chip !== undefined);
}

/** Web parity: the score badge is green from 70, amber from 30, muted below. */
export function scoreTone(score: number): 'strong' | 'fair' | 'weak' {
  if (score >= 70) return 'strong';
  if (score >= 30) return 'fair';
  return 'weak';
}

/**
 * Web parity: inMatchAudience in src/lib/matching.ts — the one
 * predicate every matched-contacts list filters and prunes by.
 * 'buyers' means every non-agent classification rather than literally
 * 'Buyer', so a match pool widened to mixed roles can never strand a
 * selected row outside all audiences.
 */
export type MatchAudience = 'buyers' | 'agents' | 'all';

export function inMatchAudience(
  classification: string | null | undefined,
  audience: MatchAudience
): boolean {
  if (audience === 'all') return true;
  return audience === 'agents'
    ? classification === 'Agent'
    : classification !== 'Agent';
}
