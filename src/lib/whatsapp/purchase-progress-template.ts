// The predefined "purchase progress" WhatsApp template — the closing
// card's question for a buyer whose 24-hour window has closed.
//
// Why a new template rather than an existing one: every approved
// template in the catalogue addresses a lead mid-ENQUIRY. enquiry_
// checkin_notice and enquiry_notice assert an open enquiry awaiting a
// decision and offer "Close my enquiry"; property_enquiry_reminder
// states a follow-up date on that enquiry; listing_status_notice
// asserts the listing is no longer available. Said to a buyer a week
// from registration, every one of them is false — and "Close my
// enquiry" marks the contact dead. That is the live incident this
// template exists to stop repeating.
//
// Why it should classify as Utility: Meta's two-part test is
// non-promotional AND specific to a transaction the recipient is
// already party to. This is the strongest Utility case in the
// catalogue — the reader has paid a token and is at legal or
// registration on this very property, and the message administers that
// transaction and nothing else. Same reasoning that holds UTILITY for
// listing_status_notice and listing_photos_notice, on stronger facts.
//
// AGENTS.md §2.7 governs what happens next: a category is decided once
// and is unfixable, and a rejected name is reserved for four weeks.
// The name and copy below are therefore deliberately narrow, and
// nothing here submits anything — registration stays a human action in
// Settings → Templates.
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
} from '@/lib/whatsapp/template-copy';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { BRANDING } from '@/config/branding';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

export const PURCHASE_PROGRESS_TEMPLATE_NAME = 'purchase_progress_notice';

export const PURCHASE_PROGRESS_TEMPLATE_NAMES = [
  PURCHASE_PROGRESS_TEMPLATE_NAME,
];

export function pickPurchaseProgressTemplate<
  T extends ApprovedTemplateCandidate,
>(rows: T[]): T | null {
  return pickApprovedTemplate(rows, PURCHASE_PROGRESS_TEMPLATE_NAMES);
}

/** Button texts round-trip through the webhook as message.button.text.
 *  Neither offers to close anything — that is the difference between
 *  this template and the enquiry family it replaces here. */
export const PURCHASE_PROGRESS_ON_TRACK_BUTTON = 'Paperwork on track';
export const PURCHASE_PROGRESS_PENDING_BUTTON = 'Something is pending';

export function buildPurchaseProgressTemplatePayload(
  _origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: PURCHASE_PROGRESS_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('purchase_progress', language),
    buttons: [
      // Quick replies only, and no URL button: a listing page is a
      // sales surface, and pointing a buyer who has already paid a
      // token back at it is the promotional signal this template
      // cannot afford. Either tap also reopens the 24-hour window.
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('paperwork_on_track', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('paperwork_pending', language),
      },
    ],
    sample_values: {
      body: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside Habitat, Whitefield',
        'Token & Legal',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{4}}: first name, the brokerage sending it, the
 * property being bought, and the stage the purchase is recorded at.
 * All four are guaranteed non-empty — Meta rejects empty values, a
 * lead filed under a placeholder is greeted "there" rather than by the
 * placeholder, and an account with no name set falls back to the
 * product name rather than sending unsigned.
 */
export function buildPurchaseProgressParams(
  contactName: string | null | undefined,
  brandName: string | null | undefined,
  propertyDescription: string,
  stageName: string | null | undefined
): [name: string, brand: string, property: string, step: string] {
  const raw = contactName?.trim() ?? '';
  const firstName =
    raw && !isPlaceholderLeadName(raw) ? raw.split(/\s+/)[0] : 'there';
  return [
    sanitizeTemplateParam(firstName) || 'there',
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    sanitizeTemplateParam(propertyDescription) || 'your purchase',
    sanitizeTemplateParam(stageName?.trim() || '') || 'in progress',
  ];
}
