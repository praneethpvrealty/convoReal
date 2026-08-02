// ============================================================
// Product Q&A for the marketing-site lead bot. Same shape as the
// showcase's property-qa/catalog-qa: the questions prospects actually
// ask — what is it, what does it cost, do my clients need an app — are
// answered for free from the marketing config that already renders the
// page, so the AI path only sees the long tail. One source of truth
// means the bot can never contradict the pricing table above it.
// ============================================================

import { MARKETING_CONFIG } from '@/config/marketing';
import { BRANDING } from '@/config/branding';

export interface SiteQaResult {
  answer: string | null;
  intent: string | null;
}

function pricingAnswer(): string {
  const plans = MARKETING_CONFIG.pricing
    .map((p) => `${p.name} at ${p.price}${p.period ? `/${p.period}` : ''}`)
    .join(', ');
  return `Plans: ${plans}. It's month-to-month — no setup fee and no lock-in, so you can change or cancel any time.`;
}

function featuresAnswer(): string {
  const titles = MARKETING_CONFIG.features.map((f) => f.title);
  const shown = titles.slice(0, 5).join(', ');
  return `${BRANDING.name} covers ${shown}${titles.length > 5 ? ', and more' : ''}. Which of those matters most to you?`;
}

function overviewAnswer(): string {
  return `${BRANDING.name} is a WhatsApp-first real-estate CRM: ${MARKETING_CONFIG.hero.subheadline}`;
}

/** FAQ entries are matched on their distinctive words, not word-for-word. */
const FAQ_STOPWORDS = new Set([
  'what',
  'is',
  'the',
  'a',
  'an',
  'do',
  'does',
  'how',
  'can',
  'i',
  'my',
  'me',
  'you',
  'your',
  'we',
  'it',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'any',
  'there',
  'with',
  'work',
  'works',
  'need',
  'are',
  'be',
  'this',
  'that',
  'have',
]);

function faqKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FAQ_STOPWORDS.has(w));
}

function faqAnswer(question: string): string | null {
  const asked = new Set(faqKeywords(question));
  if (!asked.size) return null;

  let best: { score: number; answer: string } | null = null;
  for (const faq of MARKETING_CONFIG.faqs) {
    const keywords = faqKeywords(faq.q);
    if (!keywords.length) continue;
    const hits = keywords.filter((w) => asked.has(w)).length;
    const score = hits / keywords.length;
    if (hits >= 2 && score >= 0.4 && (!best || score > best.score)) {
      best = { score, answer: faq.a };
    }
  }
  return best ? best.answer : null;
}

// Leading-boundary-anchored only (no trailing \b), so plurals and
// suffixes still match — "feature" → "features", "charge" → "charges".
const MATCHERS: {
  intent: string;
  pattern: RegExp;
  respond: () => string | null;
}[] = [
  {
    intent: 'pricing',
    pattern:
      /\b(pricing|price|cost|how much|charge|fee|plan|subscription|free trial|trial)/i,
    respond: pricingAnswer,
  },
  {
    intent: 'features',
    pattern: /\b(feature|what can it do|capabilit|include|offer)/i,
    respond: featuresAnswer,
  },
  {
    intent: 'overview',
    pattern:
      /\b(what is|what's|whats|tell me about|explain|who are you|about convoreal)/i,
    respond: overviewAnswer,
  },
];

/**
 * Deterministic answer about the product, or `{ answer: null }` when the
 * question needs the AI path. The FAQ is checked before the broad intent
 * matchers so a specific question ("can I connect my own domain?") gets
 * its specific answer rather than the pricing table.
 */
export function answerFromSiteData(question: string): SiteQaResult {
  const q = (question || '').trim();
  if (!q) return { answer: null, intent: null };

  const faq = faqAnswer(q);
  if (faq) return { answer: faq, intent: 'faq' };

  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(q)) {
      return { answer: matcher.respond(), intent: matcher.intent };
    }
  }
  return { answer: null, intent: null };
}

/** Everything the model is allowed to know about the product. */
export function buildSiteContext(): string {
  const config = MARKETING_CONFIG;
  const lines: string[] = [
    `Product: ${BRANDING.name} (${BRANDING.websiteUrl})`,
    `Positioning: ${config.hero.headlineStart}${config.hero.headlineHighlight}${config.hero.headlineEnd}`,
    `Summary: ${config.hero.subheadline}`,
    '',
    'Features:',
    ...config.features.map((f) => `- ${f.title}: ${f.description}`),
    '',
    'Plans:',
    ...config.pricing.map(
      (p) =>
        `- ${p.name} (${p.price}${p.period}): ${p.description}. Includes: ${p.features.join('; ')}`
    ),
    '',
    'FAQ:',
    ...config.faqs.map((f) => `- Q: ${f.q}\n  A: ${f.a}`),
  ];
  return lines.join('\n');
}

export const SITE_QA_SYSTEM_PROMPT =
  `You are the assistant on ${BRANDING.name}'s own website, talking to a real-estate professional evaluating the product. ` +
  `Answer ONLY from the product information provided. Keep replies short (1-3 sentences), concrete and free of hype. ` +
  `If the answer isn't in the information, say you'll have the team confirm it — do NOT invent features, integrations, limits or prices. ` +
  `Never quote a discount or a custom price, and never promise a delivery date. ` +
  `When the question is about their own business rather than the product, answer briefly and offer to set up a walkthrough on WhatsApp.`;
