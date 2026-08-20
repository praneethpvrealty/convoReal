// ============================================================
// The two lead funnels the site runs.
//
// SHOWCASE_FUNNEL — a buyer on a brokerage's public portal. Qualifies
// intent, category, locality and budget, shows matching listings from
// the catalog already on the page, then captures the number. Visitors
// who identify as a real-estate professional are not buyers, so they
// branch out to the Engine funnel instead of being filed as leads.
//
// ENGINE_FUNNEL — ConvoReal's own prospect funnel. Runs on the marketing
// site AND as the branch above, because every brokerage showcase is
// visited by agents and builders who are themselves prospects.
// ============================================================

import { FUNNEL_ENGINE, FUNNEL_END, FUNNEL_MATCH, type Funnel } from './funnel';

/** Intent chip that routes a professional into the Engine funnel. */
export const AGENT_INTENT = 'I list properties (agent/builder)';
export const RENT_INTENT = 'Renting';
/** Where the showcase funnel resumes once matches have been shown. */
export const SHOWCASE_AFTER_MATCH = 'name';

/**
 * The first chip a visitor taps is a stated intent, and the matching
 * engine has a column for it. Mapped here rather than left to the AI
 * pass over the note: extraction is told never to assume 'Sale' from
 * silence, so a "Buying" tap would otherwise reach the engine as no
 * intent at all.
 *
 * The agent chip routes into the Engine funnel and never reaches a
 * buyer requirement, so it maps to nothing.
 */
export function listingTypeForShowcaseIntent(
  intent: string | null | undefined
): 'Sale' | 'Rent' | null {
  if (intent === RENT_INTENT) return 'Rent';
  if (intent === 'Buying' || intent === 'Investing') return 'Sale';
  return null;
}

export const SALE_BUDGET_CHIPS = [
  'Under ₹50L',
  '₹50L – ₹1Cr',
  '₹1 – 2Cr',
  '₹2 – 5Cr',
  '₹5Cr+',
  'Flexible',
];

export const RENT_BUDGET_CHIPS = [
  'Under ₹25k',
  '₹25k – ₹50k',
  '₹50k – ₹1L',
  '₹1L+',
  'Flexible',
];

export const ENGINE_ROLE_CHIPS = [
  'Independent agent',
  'Broker',
  'Builder / Developer',
  'Agency / Team',
];

export const ENGINE_TEAM_CHIPS = ['Just me', '2–5', '6–20', '20+'];

export const SHOWCASE_FUNNEL: Funnel = {
  id: 'showcase',
  first: 'intent',
  steps: [
    {
      id: 'intent',
      ask: 'Hi! 👋 I can help you find the right property here — or put you straight through to the team. What brings you in?',
      chips: ['Buying', RENT_INTENT, 'Investing', AGENT_INTENT],
      key: 'intent',
      next: (answer) => (answer === AGENT_INTENT ? FUNNEL_ENGINE : 'category'),
    },
    {
      id: 'category',
      ask: 'Got it. What kind of property are you after?',
      chipsFrom: 'categories',
      input: 'text',
      placeholder: 'e.g. 3 BHK apartment',
      key: 'category',
      next: 'locality',
    },
    {
      id: 'locality',
      ask: 'Which areas work for you? Tap all that apply, or type one.',
      chipsFrom: 'localities',
      multi: true,
      optional: true,
      input: 'text',
      placeholder: 'e.g. Whitefield',
      key: 'locality',
      next: (_answer, answers) =>
        answers.intent === RENT_INTENT ? 'rent_budget' : 'budget',
    },
    {
      id: 'budget',
      ask: 'And roughly what budget are you working with?',
      chips: SALE_BUDGET_CHIPS,
      input: 'text',
      placeholder: 'e.g. 1.5 cr',
      key: 'budget',
      next: FUNNEL_MATCH,
    },
    {
      id: 'rent_budget',
      ask: 'What monthly rent are you comfortable with?',
      chips: RENT_BUDGET_CHIPS,
      input: 'text',
      placeholder: 'e.g. 40k',
      key: 'budget',
      next: FUNNEL_MATCH,
    },
    {
      id: 'name',
      ask: 'Who should the agent ask for?',
      input: 'text',
      placeholder: 'Your name',
      key: 'name',
      next: 'phone',
    },
    {
      id: 'phone',
      ask: "And your WhatsApp number? The agent will send matching listings there as they come in — including ones that aren't public yet.",
      input: 'tel',
      placeholder: '98450 12345',
      key: 'phone',
      next: FUNNEL_END,
    },
  ],
};

/** Where the prospect was found. The opening line is the only thing
 *  that differs: on a customer's portal the bot has to explain why it's
 *  suddenly talking about a deal engine, on our own site it doesn't. */
export type EngineFunnelContext = 'website' | 'showcase';

const ENGINE_OPENERS: Record<EngineFunnelContext, string> = {
  website: 'Happy to help. So I point you at the right thing — what do you do?',
  showcase:
    'Good to know! This portal runs on ConvoReal, the WhatsApp deal engine for property consultants — I can get you the same thing for your own listings. What do you do?',
};

const ENGINE_FUNNEL: Funnel = {
  id: 'engine',
  first: 'role',
  steps: [
    {
      id: 'role',
      ask: ENGINE_OPENERS.website,
      chips: ENGINE_ROLE_CHIPS,
      key: 'role',
      next: 'team_size',
    },
    {
      id: 'team_size',
      ask: 'How many people are on your team?',
      chips: ENGINE_TEAM_CHIPS,
      key: 'team_size',
      next: 'city',
    },
    {
      id: 'city',
      ask: 'Which city do you work in?',
      input: 'text',
      placeholder: 'e.g. Bangalore',
      key: 'city',
      next: 'name',
    },
    {
      id: 'name',
      ask: 'And your name?',
      input: 'text',
      placeholder: 'Your name',
      key: 'name',
      next: 'phone',
    },
    {
      id: 'phone',
      ask: "Last one — your WhatsApp number, so we can show you the Engine on the channel you'll actually use it on.",
      input: 'tel',
      placeholder: '98450 12345',
      key: 'phone',
      next: FUNNEL_END,
    },
  ],
};

export function engineFunnel(context: EngineFunnelContext): Funnel {
  return {
    ...ENGINE_FUNNEL,
    steps: ENGINE_FUNNEL.steps.map((step) =>
      step.id === 'role' ? { ...step, ask: ENGINE_OPENERS[context] } : step
    ),
  };
}
