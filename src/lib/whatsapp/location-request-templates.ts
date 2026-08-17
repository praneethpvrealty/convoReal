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

export const LOCATION_CONSENT_TEMPLATE_NAME = 'location_consent_request';
export const LOCATION_OWNER_DECISION_TEMPLATE_NAME = 'location_owner_decision';

export function buildLocationConsentTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: LOCATION_CONSENT_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('location_consent_request', language),
    buttons: [
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('approve_request', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('decline_request', language),
      },
    ],
    sample_values: {
      body: ['Suresh', 'Villa in Whitefield', 'Ra••• Sh••• (98•••••210)'],
    },
  };
}

export function buildLocationConsentParams(
  coBrokerName: string | null | undefined,
  propertyTitle: string,
  maskedRequester: string
): [name: string, property: string, requester: string] {
  return [
    sanitizeTemplateParam(coBrokerName?.trim().split(/\s+/)[0] || 'there'),
    sanitizeTemplateParam(propertyTitle.trim() || 'the property'),
    sanitizeTemplateParam(maskedRequester.trim() || 'a protected requester'),
  ];
}

export function buildLocationOwnerDecisionTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: LOCATION_OWNER_DECISION_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('location_owner_decision', language),
    buttons: [
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('approve_access', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('reject_access', language),
      },
    ],
    sample_values: {
      body: [
        'Location reveal',
        'Villa in Whitefield (PROP-9)',
        'Ra••• Sh••• · 98•••••210',
        'the exact location and photos',
      ],
    },
  };
}

export function buildLocationOwnerDecisionParams(args: {
  scope?: 'location' | 'listing';
  property: string;
  requester: string;
}): [request: string, property: string, requester: string, access: string] {
  const listing = args.scope === 'listing';
  return [
    listing ? 'Listing access' : 'Location reveal',
    sanitizeTemplateParam(args.property.trim() || 'the property'),
    sanitizeTemplateParam(args.requester.trim() || 'a protected requester'),
    listing
      ? 'the full listing, photos, address and map pin'
      : 'the exact location and photos',
  ];
}
