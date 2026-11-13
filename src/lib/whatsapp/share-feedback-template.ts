import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import {
  DEFAULT_LANGUAGE,
  isLanguageCode,
  languageForMetaCode,
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
import { renderShareTemplateBody } from '@/lib/whatsapp/share-property-preview';
import { bodyPlaceholderCount } from '@/lib/whatsapp/template-language';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const SHARE_FEEDBACK_TEMPLATE_NAME = 'property_share_feedback';
export const SHARE_FEEDBACK_TEMPLATE_NAMES = [SHARE_FEEDBACK_TEMPLATE_NAME];

export function pickShareFeedbackTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[]
): T | null {
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
      body: ['Praneeth', 'Ravi from Aryavarta Ventures'],
    },
  };
}

export function shareFeedbackFirstName(
  contactName: string | null | undefined
): string {
  const rawName = contactName?.trim() ?? '';
  const firstName =
    rawName && !isPlaceholderLeadName(rawName)
      ? rawName.split(/\s+/)[0]
      : 'there';
  return sanitizeTemplateParam(firstName) || 'there';
}

export function buildShareFeedbackParams(
  contactName: string | null | undefined,
  senderLabel: string,
  approvedBody?: string | null
): string[] {
  const params = [
    shareFeedbackFirstName(contactName),
    sanitizeTemplateParam(senderLabel),
  ];
  const count = bodyPlaceholderCount(
    approvedBody ?? templateBody('share_feedback', DEFAULT_LANGUAGE)
  );
  return params.slice(0, Math.max(1, count));
}

export function shareFeedbackLanguage(
  templateLanguage: string | null | undefined
): LanguageCode {
  const raw = templateLanguage?.trim() ?? '';
  return isLanguageCode(raw)
    ? raw
    : (languageForMetaCode(raw) ?? DEFAULT_LANGUAGE);
}

export function renderShareFeedbackBody(
  params: string[],
  templateLanguage: string | null | undefined,
  approvedBody?: string | null
): string {
  return renderShareTemplateBody(
    approvedBody ??
      templateBody('share_feedback', shareFeedbackLanguage(templateLanguage)),
    params
  );
}

export function buildShareFeedbackButtonsBody(
  firstName: string,
  propertyTitle: string,
  senderLabel: string
): string {
  return `Hi ${firstName}, this is ${sanitizeTemplateParam(senderLabel)}, following up on *${sanitizeTemplateParam(propertyTitle)}*, which I shared earlier.\n\nDid it match what you are looking for?`;
}
