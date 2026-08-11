// The predefined "enquiry timeline" WhatsApp template — asks a lead who
// said they would come back with a decision to pick WHEN we should check
// back, for a branch whose 24-hour window has closed.
//
// Why not reuse enquiry_checkin_notice: that one asks whether the
// listing is still under consideration. This lead has already answered
// that — on the agent's personal WhatsApp — and asking again reads as
// though nobody was listening. The open question is only the date.
//
// Why it should classify as Utility: Meta's two-part test is
// non-promotional AND specific to the recipient's own request. This
// administers an enquiry the lead filed and a commitment the lead
// themselves made ("I'll speak to the chairman and let you know"). Its
// only ask is a scheduling one — never whether to buy, never what else
// is available. No opt-in ask, no opt-out footer, no emoji, no
// persuasive CTA, and none of the 'options'/'deals'/'offer'/'alerts'
// vocabulary that reads as promotional at review.
//
// Note the framing this template deliberately avoids: "we noticed your
// interest" / "keeping a tab on you" is interest-anchored, which is
// re-engagement and categorises Marketing. Every Utility template this
// account holds is enquiry-anchored, and so is this one. Per
// AGENTS.md §2.7 the category is fixed at first review and the name is
// reserved for four weeks on rejection — so the wording below is the
// one shot, and it is not to be "improved" with warmth.
//
// Pure functions so payload and params are unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import {
  templateBody,
  templateButtonLabel,
  type TemplateButtonAction,
} from '@/lib/whatsapp/template-copy';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { BRANDING } from '@/config/branding';

export const TIMELINE_ASK_TEMPLATE_NAME = 'enquiry_timeline_notice';

export const TIMELINE_ASK_TEMPLATE_NAMES = [TIMELINE_ASK_TEMPLATE_NAME];

/** When the lead says they will come back to us. Shared by the template
 *  buttons and the free-form interactive buttons sent inside an open
 *  window, so both answer paths land on one handler. */
export type TimelineChoice = 'today' | '2d' | 'unsure';

const CHOICE_ACTIONS: Record<TimelineChoice, TemplateButtonAction> = {
  today: 'timeline_today',
  '2d': 'timeline_2_days',
  unsure: 'timeline_unsure',
};

export const TIMELINE_CHOICES = ['today', '2d', 'unsure'] as const;

export function timelineButtonAction(
  choice: TimelineChoice
): TemplateButtonAction {
  return CHOICE_ACTIONS[choice];
}

/** The choice a matched button action means, or null when the tap was
 *  some other template's button. Pairs with matchTemplateButton, which
 *  resolves the label in whatever language it was sent in. */
export function timelineChoiceForAction(
  action: TemplateButtonAction | null
): TimelineChoice | null {
  if (!action) return null;
  const hit = TIMELINE_CHOICES.find((c) => CHOICE_ACTIONS[c] === action);
  return hit ?? null;
}

export function buildTimelineAskTemplatePayload(
  _origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: TIMELINE_ASK_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('journey_timeline', language),
    // Quick replies only. A URL button here would turn a scheduling
    // question into a second invitation to go browse the listing,
    // which is the promotional read this template must not carry.
    buttons: TIMELINE_CHOICES.map((choice) => ({
      type: 'QUICK_REPLY' as const,
      text: templateButtonLabel(CHOICE_ACTIONS[choice], language),
    })),
    sample_values: {
      body: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside Habitat, Whitefield',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{3}}: first name, the brokerage sending it, and
 * the listing being decided on. Same shape and same guarantees as the
 * check-in template — Meta rejects empty values, a lead filed under
 * "Housing Lead" is greeted "there", and an account with no name set
 * falls back to the product name rather than sending unsigned.
 */
export function buildTimelineAskParams(
  contactName: string | null | undefined,
  brandName: string | null | undefined,
  propertyDescription: string
): [name: string, brand: string, property: string] {
  const raw = contactName?.trim() ?? '';
  const firstName =
    raw && !isPlaceholderLeadName(raw) ? raw.split(/\s+/)[0] : 'there';
  return [
    sanitizeTemplateParam(firstName) || 'there',
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    sanitizeTemplateParam(propertyDescription) || 'your enquiry',
  ];
}
