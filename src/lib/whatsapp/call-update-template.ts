// The predefined "call_update" WhatsApp template — the default channel
// for the AI call-update draft an agent sends after a call.
//
// That draft is different prose every time, so it can only go out as
// free-form text, and Meta allows free-form only inside the 24-hour
// customer service window. An agent finishing a call is usually outside
// it: the contact last messaged days ago, so the send is refused and
// there is nothing to fall back to.
//
// A body variable is the way through. The update rides in {{3}} while
// the fixed framing around it satisfies Meta's rules — a body may not
// begin or end with a variable, and a template that is mostly variable
// is rejected at review. The cost is that a parameter may not contain
// newlines, tabs or 4+ consecutive spaces, so the draft's paragraphs
// collapse to one; the send path's sanitizeParamText does that, and
// truncateParametersToBudget keeps the rendered body inside Meta's
// 1024-char cap by shortening this parameter first (it is the longest).
//
// Pure functions so the payload and the parameters are unit-testable.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const CALL_UPDATE_TEMPLATE_NAME = 'call_update';

export function buildCallUpdateTemplatePayload(): TemplatePayload {
  return {
    name: CALL_UPDATE_TEMPLATE_NAME,
    // Utility: a transactional follow-up on the contact's own ongoing
    // enquiry, not promotional content — so it is also exempt from
    // Meta's per-user marketing frequency caps (error 131049).
    category: 'Utility',
    language: 'en_US',
    // Words, not punctuation, separate every pair of variables: Meta
    // rejects placeholders that sit next to each other, and the body may
    // not open or close on one.
    body_text: [
      '📋 *Update on your enquiry*',
      '',
      'Hi {{1}}, here is the latest from {{2}} after our call:',
      '',
      '{{3}}',
      '',
      "Reply to this message if you have any questions — I'll get back to you personally.",
    ].join('\n'),
    sample_values: {
      body: [
        'Chetan',
        'Aryavart Ventures',
        'I spoke with the owner-side consultant today. The owner is back on the 5th, and I will confirm your site-visit slot as soon as I have their schedule.',
      ],
    },
  };
}

/**
 * Body params {{1}}..{{3}}: first name, sender, the update itself.
 * Every param is guaranteed non-empty — Meta rejects empty values.
 * Whitespace flattening and the length budget are the send path's job
 * (sanitizeParamText / truncateParametersToBudget), so the update text
 * is passed through whole.
 */
export function buildCallUpdateParams(
  contactName: string | null | undefined,
  senderName: string | null | undefined,
  update: string
): [name: string, sender: string, update: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  return [
    firstName,
    senderName?.trim() || 'your agent',
    update.trim() || 'Sharing an update on your enquiry.',
  ];
}
