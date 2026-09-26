import { BRANDING } from '@/config/branding';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
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

export const PORTFOLIO_ACCESS_TEMPLATE_NAME = 'portfolio_access_notice';

export function buildPortfolioAccessTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: PORTFOLIO_ACCESS_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('portfolio_access', language),
    buttons: [
      {
        type: 'URL',
        text: templateButtonLabel('portfolio_sign_in', language),
        url: `${origin.replace(/\/+$/, '')}/{{1}}`,
        example: 'buyer/login',
      },
    ],
    sample_values: {
      body: ['Praneeth', 'Aryavarta Ventures'],
    },
  };
}

export function buildPortfolioAccessParams(
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

export function portfolioAccessButtonSuffix(url: string): string {
  return new URL(url).pathname.replace(/^\/+/, '');
}
