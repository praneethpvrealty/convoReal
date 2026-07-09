// ============================================================
// Plan configuration — single source of truth for pricing,
// display names, and feature descriptions.
// Must stay in sync with the CHECK constraint in 073_billing_subscriptions.sql
// and the CASE blocks in the account_plan_limits view.
// ============================================================

import type { Plan, BillingCycle } from './types';

export interface PlanConfig {
  id: Plan;
  name: string;
  tagline: string;
  monthlyPrice: number;   // INR, monthly billing
  quarterlyPrice: number;  // INR, quarterly billing (total for 3 months)
  annualPrice: number;    // INR, annual billing (total for 12 months)
  annualMonthlyEquiv: number; // annual / 12 for display
  quarterlyMonthlyEquiv: number; // quarterly / 3 for display
  maxUsers: number;
  maxContacts: number;
  maxProperties: number;
  maxBroadcastsPerMonth: number;
  features: string[];
  notIncluded: string[];
  highlighted: boolean;   // show as "most popular"
}

export const PLAN_CONFIG: Record<Plan, PlanConfig> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'Try it free',
    monthlyPrice: 0,
    quarterlyPrice: 0,
    annualPrice: 0,
    annualMonthlyEquiv: 0,
    quarterlyMonthlyEquiv: 0,
    maxUsers: 1,
    maxContacts: 150,
    maxProperties: 50,
    maxBroadcastsPerMonth: 0,
    features: [
      '1 user',
      '150 contacts',
      '50 properties',
      'WhatsApp inbox',
      'Basic showcase page',
      '100 monthly AI credits',
    ],
    notIncluded: [
      'Broadcasts',
      'Automations & Flows',
      'Team features',
      'Branded showcase',
      'Custom subdomain',
    ],
    highlighted: false,
  },
  solo_pro: {
    id: 'solo_pro',
    name: 'Solo Pro',
    tagline: 'For individual agents',
    monthlyPrice: 799,
    quarterlyPrice: 2199,
    annualPrice: 7990,
    annualMonthlyEquiv: 666,
    quarterlyMonthlyEquiv: 733,
    maxUsers: 1,
    maxContacts: 999999,
    maxProperties: 999999,
    maxBroadcastsPerMonth: 500,
    features: [
      '1 user',
      'Unlimited contacts & properties',
      'WhatsApp inbox',
      'Branded showcase (logo & colors)',
      'AI description, chatbot & images',
      '500 broadcasts/month',
      'Email lead sync (portals)',
      'Automations & Flows',
      'Pipelines (Kanban)',
    ],
    notIncluded: [
      'Team features & org hierarchy',
      'Smart inbound routing',
      'Multi-number WhatsApp',
      'API access',
      'Custom subdomain',
    ],
    highlighted: false,
  },
  team: {
    id: 'team',
    name: 'Team',
    tagline: 'For small brokerages',
    monthlyPrice: 2499,
    quarterlyPrice: 6899,
    annualPrice: 24990,
    annualMonthlyEquiv: 2083,
    quarterlyMonthlyEquiv: 2300,
    maxUsers: 10,
    maxContacts: 999999,
    maxProperties: 999999,
    maxBroadcastsPerMonth: 2000,
    features: [
      'Up to 10 users',
      'Unlimited contacts & properties',
      'Everything in Solo Pro',
      'Teams & org hierarchy',
      'Smart inbound routing',
      'Team analytics',
      '2,000 broadcasts/month',
      'Advanced routing rules (limited)',
    ],
    notIncluded: [
      'Multi-number WhatsApp',
      'Org-wide analytics',
      'API access',
      'Custom subdomain',
    ],
    highlighted: true,
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    tagline: 'For established agencies',
    monthlyPrice: 5999,
    quarterlyPrice: 16499,
    annualPrice: 59990,
    annualMonthlyEquiv: 4999,
    quarterlyMonthlyEquiv: 5500,
    maxUsers: 999999,
    maxContacts: 999999,
    maxProperties: 999999,
    maxBroadcastsPerMonth: 5000,
    features: [
      'Unlimited users',
      'Unlimited contacts & properties',
      'Everything in Team',
      'Multi-number WhatsApp (per team)',
      'Full routing rules',
      'Org-wide analytics',
      'API access & outbound webhooks',
      'Custom subdomain showcase',
      '5,000 broadcasts/month',
      'Priority support (24h SLA)',
      'White-label add-on available',
    ],
    notIncluded: [],
    highlighted: false,
  },
};

export const PLAN_ORDER: Plan[] = ['starter', 'solo_pro', 'team', 'agency'];

export function planRank(plan: Plan): number {
  return PLAN_ORDER.indexOf(plan);
}

export function isUpgrade(from: Plan, to: Plan): boolean {
  return planRank(to) > planRank(from);
}

export function isDowngrade(from: Plan, to: Plan): boolean {
  return planRank(to) < planRank(from);
}

export function getPlanPrice(plan: Plan, cycle: BillingCycle): number {
  const config = PLAN_CONFIG[plan];
  if (cycle === 'annual') return config.annualPrice;
  if (cycle === 'quarterly') return config.quarterlyPrice;
  return config.monthlyPrice;
}

/** Upgrade required to unlock a feature, starting from current plan */
export function upgradeRequiredFor(feature: string, currentPlan: Plan): Plan | null {
  switch (feature) {
    case 'ai':
    case 'broadcasts':
    case 'branded_showcase':
      return currentPlan === 'starter' ? 'solo_pro' : null;
    case 'teams':
      return planRank(currentPlan) < planRank('team') ? 'team' : null;
    case 'multi_number':
    case 'api_access':
    case 'custom_subdomain':
      return planRank(currentPlan) < planRank('agency') ? 'agency' : null;
    default:
      return null;
  }
}
