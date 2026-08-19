import { BRANDING } from '@/config/branding';
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

export const REQUIREMENT_REVIEW_TEMPLATE_NAME = 'property_requirement_review';
export const REQUIREMENT_REVIEW_TEMPLATE_NAMES = [
  REQUIREMENT_REVIEW_TEMPLATE_NAME,
];
export const REQUIREMENT_REVIEW_BUTTON = 'Update my preferences';

export function pickRequirementReviewTemplate<
  T extends ApprovedTemplateCandidate,
>(rows: T[]): T | null {
  return pickApprovedTemplate(rows, REQUIREMENT_REVIEW_TEMPLATE_NAMES);
}

export function buildRequirementReviewTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: REQUIREMENT_REVIEW_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('requirement_review', language),
    buttons: [
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('update_preferences', language),
      },
    ],
    sample_values: {
      body: ['Praneeth', 'Aryavarta Ventures'],
    },
  };
}

export function buildRequirementReviewParams(
  contactName: string | null | undefined,
  brandName?: string | null
): [name: string, brand: string] {
  const rawName = contactName?.trim() ?? '';
  const firstName =
    rawName && !isPlaceholderLeadName(rawName)
      ? rawName.split(/\s+/)[0]
      : 'there';
  return [
    sanitizeTemplateParam(firstName) || 'there',
    sanitizeTemplateParam(brandName?.trim() || BRANDING.name),
  ];
}
