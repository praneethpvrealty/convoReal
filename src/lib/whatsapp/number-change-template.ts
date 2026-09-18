import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import {
  templateBody,
  templateButtonLabel,
} from '@/lib/whatsapp/template-copy';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const NUMBER_CHANGE_TEMPLATE_NAME = 'contact_number_update';
export const NUMBER_CHANGE_TEMPLATE_NAMES = [NUMBER_CHANGE_TEMPLATE_NAME];

export function buildNumberChangeTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: NUMBER_CHANGE_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('contact_number_update', language),
    buttons: [
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('acknowledge_update', language),
      },
    ],
    sample_values: {
      body: ['Praneeth', 'Aryavarta Realty', '+91 88677 09556'],
    },
  };
}

export function buildNumberChangeParams(
  contactName: string | null | undefined,
  businessName: string,
  previousNumber: string
): [name: string, business: string, previousNumber: string] {
  return [
    sanitizeTemplateParam(leadFirstName(contactName)) || 'there',
    sanitizeTemplateParam(businessName.trim()) || 'our team',
    sanitizeTemplateParam(previousNumber.trim()),
  ];
}

export function renderNumberChangeNotice(
  language: LanguageCode,
  params: readonly string[]
): string {
  return templateBody('contact_number_update', language).replace(
    /\{\{(\d+)\}\}/g,
    (match, index: string) => params[Number(index) - 1] ?? match
  );
}
