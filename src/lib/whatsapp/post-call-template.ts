// The post-call opener — the first WhatsApp message after a voice call
// (docs/post-call-followup-plan.md §2). A phone call does not open
// Meta's 24-hour window, so this template is how a follow-up reaches a
// lead who has never messaged in: one Utility-worded opener whose
// quick reply, once tapped, opens the window for the rich follow-up
// (listings, photos, the agent's intro) to ride free-form behind it.
//
// One opener per flow, not a template per disposition — a dozen
// Marketing templates is a dozen chances to be silently dropped at a
// recipient's cap (AGENTS.md §2.7), and a dozen names spent.
//
// Why it should classify as Utility: it is administration of a call
// the lead just took about an enquiry they themselves filed — states
// what was captured, asks one yes/no question, promises silence
// otherwise. No promotion vocabulary, no emoji, no persuasive CTA.

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

export const POST_CALL_OPENER_TEMPLATE_NAME = 'post_call_options';

export const POST_CALL_OPENER_TEMPLATE_NAMES = [POST_CALL_OPENER_TEMPLATE_NAME];

export function pickPostCallOpenerTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[]
): T | null {
  return pickApprovedTemplate(rows, POST_CALL_OPENER_TEMPLATE_NAMES);
}

export function buildPostCallOpenerTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: POST_CALL_OPENER_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('post_call_options', language),
    buttons: [
      // The tap is the inbound message that opens the 24-hour window.
      // Its payload is overridden at send time with the follow-up id,
      // so the webhook routes it without matching on wording.
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('send_options', language),
      },
    ],
    sample_values: {
      body: ['Praneeth', 'Aryavarta Ventures', '₹8–9 Cr in HSR Layout'],
    },
  };
}

/**
 * Body params {{1}}..{{3}}: first name, the brokerage calling, and the
 * requirement the call captured. All guaranteed non-empty — Meta
 * rejects empty values, and a call that captured no requirement still
 * reads honestly as "your stated requirement".
 */
export function buildPostCallOpenerParams(
  contactName: string | null | undefined,
  brandName: string | null | undefined,
  requirementText: string | null | undefined
): [name: string, brand: string, requirement: string] {
  const raw = contactName?.trim() ?? '';
  const firstName =
    raw && !isPlaceholderLeadName(raw) ? raw.split(/\s+/)[0] : 'there';
  return [
    sanitizeTemplateParam(firstName) || 'there',
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
    sanitizeTemplateParam(requirementText?.trim() || '') ||
      'your stated requirement',
  ];
}
