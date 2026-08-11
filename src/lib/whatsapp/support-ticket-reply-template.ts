// The predefined template a help-desk answer travels in when the
// requester chose WhatsApp and their 24-hour window is closed — which
// is the normal case: tickets are filed from the in-app helper, not
// from a WhatsApp conversation with us.
//
// UTILITY on the merits: the message answers a support request the
// user themselves filed, quoting their own reference. Nothing is
// promoted. That categorisation is what lets the answer reach them at
// all (AGENTS.md §2.7).
//
// Lives on the PLATFORM WABA alongside the subscription-extension
// pair — ConvoReal is the sender, not the tenant — so it is
// deliberately not in ENGINE_TEMPLATES, and the Admin → Overview
// Platform Templates card is where it gets submitted.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

export const SUPPORT_TICKET_REPLY_TEMPLATE_NAME = 'support_ticket_reply';

/**
 * The (name, language) pair a send must address, read off the payload
 * builder — Meta keys a template on BOTH and a mismatch fails with
 * 132001, silently demoting the answer to the free-form fallback that
 * reaches nobody outside an open window.
 */
export function supportTicketReplyTemplate(): {
  name: string;
  language: string;
} {
  const payload = buildSupportTicketReplyTemplatePayload();
  return { name: payload.name, language: payload.language };
}

/** {{1}} reference, {{2}} answer. Template parameters cannot carry
 *  newlines, so the staff-written answer is flattened; the email copy
 *  of the same answer keeps its formatting. */
export function buildSupportTicketReplyParams(
  reference: string,
  answer: string
): string[] {
  return [sanitizeTemplateParam(reference), sanitizeTemplateParam(answer)];
}

export function buildSupportTicketReplyTemplatePayload(): TemplatePayload {
  return {
    name: SUPPORT_TICKET_REPLY_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    body_text: [
      'Hi! Here is the answer to your support request *{{1}}*.',
      '',
      '{{2}}',
      '',
      'Reply to this message if you need more help.',
    ].join('\n'),
    footer_text: 'ConvoReal Support',
    // A tap opens the 24-hour window, so a follow-up question can be
    // asked right here instead of filing a fresh ticket.
    buttons: [{ type: 'QUICK_REPLY', text: 'I need more help' }],
    sample_values: {
      body: [
        'HELP-4F2A',
        'Broadcasts only send approved templates. Open Settings, then WhatsApp, then Templates on the desktop dashboard and press Submit for approval on your draft — most approvals land within an hour.',
      ],
    },
  };
}
