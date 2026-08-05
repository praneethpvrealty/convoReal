import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { brand } from './theme';

// Plan catalog mirrored from the web's src/lib/billing/plan-config.ts —
// tier, label, positioning and headline limits — so the mobile plan card
// shows the real subscription level with a distinct, premium look.

export type Plan = 'starter' | 'solo_pro' | 'team' | 'agency';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Per-tier gradients. These are deliberately NOT brand violet — a plan
 * card's job is to tell the tiers apart at a glance, so each one owns a
 * hue and only Solo Pro carries the brand. Kept here rather than in the
 * theme because they are plan data, not UI chrome.
 */
const TIER_GRADIENTS = {
  slate: ['#475569', '#1e293b'],
  sky: ['#0ea5e9', '#0c4a6e'],
  violet: [brand.violet, '#5b21b6'],
  amber: ['#f59e0b', '#92400e'],
} as const satisfies Record<string, readonly [string, string]>;

export const PLAN_META: Record<
  Plan,
  { label: string; tagline: string; icon: IconName; gradient: readonly [string, string]; perks: string }
> = {
  starter: {
    label: 'Starter',
    tagline: 'Try it free',
    icon: 'sparkles',
    gradient: TIER_GRADIENTS.slate,
    perks: '1 user · 150 contacts',
  },
  solo_pro: {
    label: 'Solo Pro',
    tagline: 'For individual agents',
    icon: 'star',
    gradient: TIER_GRADIENTS.sky,
    perks: '1,500 contacts · 500 broadcasts / mo',
  },
  team: {
    label: 'Team',
    tagline: 'For small teams',
    icon: 'people',
    gradient: TIER_GRADIENTS.violet,
    perks: '3 members · 4,500 contacts · 2,000 broadcasts / mo',
  },
  agency: {
    label: 'Agency',
    tagline: 'For established agencies',
    icon: 'diamond',
    gradient: TIER_GRADIENTS.amber,
    perks: '10 members · 15,000 contacts · 5,000 broadcasts / mo',
  },
};

export const PLAN_CTA: Record<Plan, string> = {
  starter: 'See plans & upgrade',
  solo_pro: 'Manage or upgrade',
  team: 'Manage or upgrade',
  agency: 'Manage plan',
};
