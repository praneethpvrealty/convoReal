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
// TWO NAMES LIVE HERE, and the reason is the whole point of the file.
//
//   enquiry_timeline_notice   — submitted first, came back MARKETING.
//                               Approved and still sending.
//   property_enquiry_reminder — the Utility attempt.
//
// Meta fixes a category at first review and will not move it, so a
// miscategorised template is replaced by a differently-named one while
// the old row keeps sending (AGENTS.md §2.7, pick-approved-template).
// Category outranks name at send time: the moment the reminder is
// approved as Utility it wins, and until then the Marketing row still
// reaches the lead.
//
// WHY THE FIRST ONE FAILED, from this account's own approved set:
// every Utility template here that asks the recipient to tap names a
// concrete item already on their record and lets them confirm or
// change it — a meeting on a date, a visit on a date, an enquiry that
// is open. The four reminder templates share one sentence almost
// verbatim: "Please tap a button below to confirm or request a
// change." The first attempt instead described outreach WE intended to
// make ("please choose when we should check back"), which is
// re-engagement however politely it is worded.
//
// So the reminder below states a follow-up date already stamped on the
// lead's journey item and offers to move it. That is administration of
// their own record, which is what Utility means.
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

/** The Utility attempt — shaped like the reminder family. */
export const FOLLOWUP_REMINDER_TEMPLATE_NAME = 'property_enquiry_reminder';

/** The first attempt. Approved, but MARKETING. */
export const TIMELINE_ASK_TEMPLATE_NAME = 'enquiry_timeline_notice';

/** Newest-preferred first; pickApprovedTemplate still puts an approved
 *  Utility row ahead of an approved Marketing one whatever the order. */
export const TIMELINE_ASK_TEMPLATE_NAMES = [
  FOLLOWUP_REMINDER_TEMPLATE_NAME,
  TIMELINE_ASK_TEMPLATE_NAME,
];

/** How many days out the follow-up is set when the lead has not
 *  chosen — the date {{4}} states, and the value stamped on the
 *  journey item so the message is true when it lands. */
export const DEFAULT_FOLLOWUP_DAYS = 3;

/** Body params differ per candidate (the reminder names a date, the
 *  older one does not), so the send path builds them from the row it
 *  actually picked rather than assuming a shape. */
export function timelineTemplateParams(
  templateName: string,
  args: {
    contactName: string | null | undefined;
    brandName: string | null | undefined;
    propertyDescription: string;
    /** Preformatted, e.g. "14 Aug 2026". */
    followUpDate: string;
  }
): string[] {
  const base = buildTimelineAskParams(
    args.contactName,
    args.brandName,
    args.propertyDescription
  );
  return templateName === FOLLOWUP_REMINDER_TEMPLATE_NAME
    ? [...base, sanitizeTemplateParam(args.followUpDate) || 'shortly']
    : [...base];
}

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

/**
 * The Utility attempt: a dated follow-up on the lead's own enquiry,
 * confirmable or movable from the buttons — the shape this account's
 * four approved reminder templates share.
 */
export function buildFollowupReminderTemplatePayload(
  _origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: FOLLOWUP_REMINDER_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('journey_followup_reminder', language),
    buttons: TIMELINE_CHOICES.map((choice) => ({
      type: 'QUICK_REPLY' as const,
      text: templateButtonLabel(CHOICE_ACTIONS[choice], language),
    })),
    sample_values: {
      body: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside Habitat, Whitefield',
        '14 Aug 2026',
      ],
    },
  };
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
