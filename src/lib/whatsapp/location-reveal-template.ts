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
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

export const LOCATION_REVEAL_TEMPLATE_NAME = 'location_reveal';

export function buildLocationRevealTemplatePayload(
  origin: string
): TemplatePayload {
  return {
    name: LOCATION_REVEAL_TEMPLATE_NAME,
    // Utility: a transactional response to the seeker's own request,
    // not promotional content — also exempt from Meta's per-user
    // marketing frequency caps (error 131049).
    category: 'Utility',
    language: 'en_US',
    body_text: [
      '📍 *Location Request Approved*',
      '',
      'Hi {{1}}, your request for the exact location of {{2}} has been approved by the listing team.',
      '',
      'Tap the button below to view the address, map pin and full photos. The link stays valid for 48 hours.',
    ].join('\n'),
    buttons: [
      {
        type: 'URL',
        text: 'View location',
        url: `${origin.replace(/\/+$/, '')}/reveal/{{1}}`,
        example: '9db392b91ba84d1ab88b77ca26c6f6bc9c166ff124b1471f',
      },
    ],
    sample_values: {
      body: ['Rahul', 'Villa in Whitefield'],
    },
  };
}

/**
 * Body params {{1}}..{{2}}: first name, property title. Every param is
 * guaranteed non-empty (Meta rejects empty values).
 */
export function buildLocationRevealParams(
  requesterName: string | null | undefined,
  propertyTitle: string
): [name: string, title: string] {
  const firstName = requesterName?.trim().split(/\s+/)[0] || 'there';
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(propertyTitle.trim() || 'the property'),
  ];
}
