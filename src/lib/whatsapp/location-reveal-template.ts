// The predefined "location_reveal" WhatsApp template — the template
// channel for approved location reveal requests. Seekers request the
// exact location from the public showcase page, so they almost never
// have an open 24-hour service window; the free-form reveal message
// fails with Meta's 131047 re-engagement error unless they happen to
// have messaged recently. The pre-approved Utility template carries the
// reveal link as a URL button suffix instead. Same one-click submit
// flow as new_property_alert; pure functions so payload and params are
// unit-testable.

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

export const LOCATION_REVEAL_TEMPLATE_NAME = 'location_reveal';

export function buildLocationRevealTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: LOCATION_REVEAL_TEMPLATE_NAME,
    // Utility: a transactional response to the seeker's own request,
    // not promotional content — also exempt from Meta's per-user
    // marketing frequency caps (error 131049).
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('location_reveal', language),
    buttons: [
      {
        type: 'URL',
        text: templateButtonLabel('view_location', language),
        url: `${origin.replace(/\/+$/, '')}/reveal/{{1}}`,
        example: '9db392b91ba84d1ab88b77ca26c6f6bc9c166ff124b1471f',
      },
    ],
    sample_values: {
      body: [
        'Rahul',
        'Villa in Whitefield',
        'Villa · 3 BHK · 2400 sqft · East facing · ₹2.4 Cr',
        'Available only through the secure link',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{4}}: first name, property title, the one-line
 * specs, the secure-location notice. Every param is guaranteed non-empty (Meta rejects
 * empty values) and single-line (Meta rejects a newline inside one —
 * `sanitizeTemplateParam` collapses whitespace to enforce it).
 *
 * The specs and location notice arrive already flattened from
 * `buildRevealTemplateFacts`; the fallbacks here are the last line of
 * defence for a caller that has no property row to read.
 */
export function buildLocationRevealParams(
  requesterName: string | null | undefined,
  propertyTitle: string,
  specs?: string | null
): [name: string, title: string, specs: string, locationAccess: string] {
  const firstName = requesterName?.trim().split(/\s+/)[0] || 'there';
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(propertyTitle.trim() || 'the property'),
    sanitizeTemplateParam(specs?.trim() || 'Full details on the link below'),
    'Available only through the secure link',
  ];
}
