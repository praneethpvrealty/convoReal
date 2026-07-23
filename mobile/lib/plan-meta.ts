import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

// Plan catalog mirrored from the web's src/lib/billing/plan-config.ts —
// tier, label, positioning and headline limits — so the mobile plan card
// shows the real subscription level with a distinct, premium look.

export type Plan = 'starter' | 'solo_pro' | 'team' | 'agency';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const PLAN_META: Record<
  Plan,
  { label: string; tagline: string; icon: IconName; gradient: [string, string]; perks: string }
> = {
  starter: {
    label: 'Starter',
    tagline: 'Your free plan',
    icon: 'sparkles',
    gradient: ['#475569', '#1e293b'],
    perks: '1 user · 50 contacts',
  },
  solo_pro: {
    label: 'Solo Pro',
    tagline: 'For individual agents',
    icon: 'star',
    gradient: ['#0ea5e9', '#0c4a6e'],
    perks: '1,500 contacts · 500 broadcasts / mo',
  },
  team: {
    label: 'Team',
    tagline: 'For growing brokerages',
    icon: 'people',
    gradient: ['#8b5cf6', '#5b21b6'],
    perks: '3 members · 4,500 contacts · 2,000 broadcasts / mo',
  },
  agency: {
    label: 'Agency',
    tagline: 'For established agencies',
    icon: 'diamond',
    gradient: ['#f59e0b', '#92400e'],
    perks: '10 members · 15,000 contacts · unlimited broadcasts',
  },
};

export const PLAN_CTA: Record<Plan, string> = {
  starter: 'See plans & upgrade',
  solo_pro: 'Manage or upgrade',
  team: 'Manage or upgrade',
  agency: 'Manage plan',
};
