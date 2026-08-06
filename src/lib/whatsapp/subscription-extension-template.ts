// The two predefined templates ConvoReal uses to tell a customer their
// subscription was extended, plus the copy that fills them.
//
// There are two rather than one because the two situations do not sound
// alike. When we broke something, the message has to lead with an
// apology and own it. When we are simply being generous, an apology
// would be strange — and inventing a fault that did not happen is its
// own kind of dishonesty. A single template with a swappable middle
// sentence cannot carry both, because the fixed text around it is
// exactly what differs.
//
// Both are UTILITY: a factual update about the customer's own account
// and billing period, not promotion. That matters — it is what lets
// them reach a customer with no open 24-hour service window
// (AGENTS.md §2.7).
//
// These live on the PLATFORM WABA alongside 'whatsapp_otp', not on each
// tenant's, because ConvoReal is the sender. They are deliberately not
// in ENGINE_TEMPLATES, which prompts every tenant to create templates on
// their own WABA.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

export const EXTENSION_APOLOGY_TEMPLATE_NAME = 'subscription_extension_apology';
export const EXTENSION_GOODWILL_TEMPLATE_NAME =
  'subscription_extension_goodwill';

export type ExtensionTone = 'apology' | 'goodwill';

/** Which reasons are our fault. Anything we caused leads with an
 *  apology; the rest are gestures and must not pretend otherwise. */
const APOLOGY_REASONS = new Set([
  'outage',
  'degraded_service',
  'billing_error',
]);

export function toneForReason(reason: string): ExtensionTone {
  return APOLOGY_REASONS.has(reason) ? 'apology' : 'goodwill';
}

export function templateNameForTone(tone: ExtensionTone): string {
  return tone === 'apology'
    ? EXTENSION_APOLOGY_TEMPLATE_NAME
    : EXTENSION_GOODWILL_TEMPLATE_NAME;
}

export function buildExtensionApologyTemplatePayload(): TemplatePayload {
  return {
    name: EXTENSION_APOLOGY_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, we owe you an apology.',
      '',
      '{{2}}',
      '',
      'That was our fault, not anything you did, and we know it got in the way of your work. We have added *{{3}}* to your subscription at no charge — your access now runs to *{{4}}*.',
      '',
      'Thank you for your patience with us.',
    ].join('\n'),
    footer_text: 'ConvoReal · no action needed from you',
    // A tap opens the 24-hour window, so a customer who wants to tell us
    // how much this cost them can do it right here instead of hunting
    // for a support address.
    buttons: [{ type: 'QUICK_REPLY', text: 'Talk to someone' }],
    sample_values: {
      body: [
        'Gopi',
        'ConvoReal was down for about 3 hours this morning, and messages, listings and automations were unreachable during that time.',
        '7 days',
        '14 September 2026',
      ],
    },
  };
}

export function buildExtensionGoodwillTemplatePayload(): TemplatePayload {
  return {
    name: EXTENSION_GOODWILL_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi {{1}}, a quick note from the ConvoReal team.',
      '',
      '{{2}}',
      '',
      'We have added *{{3}}* to your subscription at no charge — your access now runs to *{{4}}*.',
      '',
      'Nothing changes on your side, and there is nothing to pay.',
    ].join('\n'),
    footer_text: 'ConvoReal · no action needed from you',
    buttons: [{ type: 'QUICK_REPLY', text: 'Talk to someone' }],
    sample_values: {
      body: [
        'Gopi',
        'Getting your account set up took longer than it should have, and you were patient throughout.',
        '14 days',
        '21 September 2026',
      ],
    },
  };
}

/**
 * The default middle sentence for each reason — what actually happened,
 * in plain words, from the customer's point of view rather than ours.
 *
 * An admin can override this per grant with a customer_message when they
 * know the specifics; these are the honest fallback when they don't.
 */
export const REASON_SENTENCES: Record<string, string> = {
  outage:
    'ConvoReal was unavailable for a period, and during that time you could not reach your inbox, listings or automations.',
  degraded_service:
    'ConvoReal was slow and unreliable for a period, and parts of it did not work the way they should have.',
  billing_error:
    'We made a mistake on your billing, and you were charged incorrectly as a result.',
  onboarding_delay:
    'Getting your account fully set up took longer than it should have, and you were patient with us throughout.',
  support_goodwill:
    'You have been with us through a few rough edges, and we would like to say thank you properly.',
};

export function sentenceForReason(
  reason: string,
  customerMessage?: string | null
): string {
  const override = customerMessage?.trim();
  if (override) return override;
  return REASON_SENTENCES[reason] ?? REASON_SENTENCES.support_goodwill;
}

export function daysPhrase(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Long-form date, matching how the billing screens read dates back. */
export function formatAccessDate(iso: string | null | undefined): string {
  if (!iso) return 'your next renewal';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'your next renewal';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export interface ExtensionMessageInput {
  contactName?: string | null;
  reason: string;
  customerMessage?: string | null;
  days: number;
  newPeriodEnd: string | null;
}

/**
 * Body params {{1}}..{{4}}: first name, what happened, days phrase, new
 * access date. Every param is non-empty and newline-free — Meta rejects
 * both, and a newline inside a param silently breaks the layout.
 */
export function buildExtensionTemplateParams(
  input: ExtensionMessageInput
): [name: string, what: string, days: string, until: string] {
  const firstName = input.contactName?.trim().split(/\s+/)[0] || 'there';
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(
      sentenceForReason(input.reason, input.customerMessage)
    ),
    sanitizeTemplateParam(daysPhrase(input.days)),
    sanitizeTemplateParam(formatAccessDate(input.newPeriodEnd)),
  ];
}

/**
 * Free-form equivalent, used only when the template send fails (most
 * likely because it is not approved on the platform WABA yet). Same
 * words, so a customer never gets a colder message just because our
 * template pipeline had a bad day.
 */
export function buildExtensionFallbackText(
  input: ExtensionMessageInput
): string {
  const [name, what, days, until] = buildExtensionTemplateParams(input);
  const tone = toneForReason(input.reason);

  if (tone === 'apology') {
    return [
      `Hi ${name}, we owe you an apology.`,
      '',
      what,
      '',
      `That was our fault, not anything you did, and we know it got in the way of your work. We have added *${days}* to your subscription at no charge — your access now runs to *${until}*.`,
      '',
      'Thank you for your patience with us.',
    ].join('\n');
  }

  return [
    `Hi ${name}, a quick note from the ConvoReal team.`,
    '',
    what,
    '',
    `We have added *${days}* to your subscription at no charge — your access now runs to *${until}*.`,
    '',
    'Nothing changes on your side, and there is nothing to pay.',
  ].join('\n');
}

/** In-app bell copy. Short by necessity — the detail is in the email. */
export function buildExtensionNotificationCopy(input: ExtensionMessageInput): {
  title: string;
  body: string;
} {
  const tone = toneForReason(input.reason);
  return {
    title:
      tone === 'apology'
        ? `We added ${daysPhrase(input.days)} to your subscription`
        : `${daysPhrase(input.days)} added to your subscription`,
    body: `${sentenceForReason(input.reason, input.customerMessage)} Your access now runs to ${formatAccessDate(input.newPeriodEnd)}.`,
  };
}
