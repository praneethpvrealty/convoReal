import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';
import {
  templateBody,
  templateButtonLabel,
} from '@/lib/whatsapp/template-copy';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const SHARE_FEEDBACK_TEMPLATE_NAME = 'property_share_feedback';
export const SHARE_FEEDBACK_TEMPLATE_NAMES = [
  SHARE_FEEDBACK_TEMPLATE_NAME,
];

export function pickShareFeedbackTemplate<
  T extends ApprovedTemplateCandidate,
>(rows: T[]): T | null {
  return pickApprovedTemplate(rows, SHARE_FEEDBACK_TEMPLATE_NAMES);
}

export function buildShareFeedbackTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: SHARE_FEEDBACK_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('share_feedback', language),
    buttons: [
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('feedback_perfect', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('feedback_not_interested', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('update_preferences', language),
      },
    ],
    sample_values: {
      body: ['Praneeth'],
    },
  };
}

export function buildShareFeedbackParams(
  contactName: string | null | undefined
): [name: string] {
  const rawName = contactName?.trim() ?? '';
  const firstName =
    rawName && !isPlaceholderLeadName(rawName)
      ? rawName.split(/\s+/)[0]
      : 'there';
  return [
    sanitizeTemplateParam(firstName) || 'there',
  ];
}
