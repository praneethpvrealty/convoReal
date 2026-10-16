// The shared "occasion_greeting" WhatsApp template every festival /
// occasion greeting broadcast sends through. One template serves every
// occasion: the greeting itself is body variable {{2}} and the card
// image rides in the IMAGE header at send time, so a new occasion never
// needs a new Meta submission (and never burns a template name — see
// AGENTS.md §2.7).
//
// Category is Marketing on purpose. A festival greeting is promotional
// under Meta's two-part test, and a Utility submission would be
// approved as Marketing anyway (normalizeCategory keeps whatever Meta
// assigns). Sends are gated by the STOP ALERTS opt-out: declined
// contacts are filtered out of every broadcast audience.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import type { VariableMapping } from '@/lib/broadcasts/sender';
import {
  ensureSharedTemplate,
  type SharedTemplateState,
} from '@/lib/whatsapp/ensure-shared-template';

export const OCCASION_GREETING_TEMPLATE_NAME = 'occasion_greeting';

export function buildOccasionGreetingTemplatePayload(
  origin: string
): TemplatePayload {
  const base = origin.replace(/\/+$/, '');
  return {
    name: OCCASION_GREETING_TEMPLATE_NAME,
    category: 'Marketing',
    language: 'en_US',
    header_type: 'image',
    // Review-time sample only — a stable PNG every deployment serves.
    // Real sends override it with the greeting's card image
    // (headerMediaUrl), falling back to the account's brand image.
    header_media_url: `${base}/brand/app-icon-1024.png`,
    body_text:
      'Dear {{1}}, we have a special wish for you today. {{2}} Warm regards from all of us at {{3}} — thank you for your continued trust.',
    footer_text: 'Reply STOP ALERTS to opt out of these messages',
    sample_values: {
      body: [
        'Priya',
        'May Lord Ganesha fill your home with prosperity, wisdom and new beginnings this Ganesh Chaturthi!',
        'Skyline Realty',
      ],
    },
  };
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The broadcast variable mappings for one greeting: {{1}} resolves per
 *  recipient (greetable name fallback), {{2}} and {{3}} are static. */
export function buildOccasionGreetingVariables(
  messageText: string,
  agencyName: string
): Record<string, VariableMapping> {
  return {
    '1': { type: 'field', value: 'name' },
    '2': { type: 'static', value: singleLine(messageText) },
    '3': { type: 'static', value: singleLine(agencyName) },
  };
}

export type OccasionGreetingTemplateState = SharedTemplateState;

/**
 * Returns the account's occasion_greeting template state, auto-submitting
 * the predefined payload to Meta when the account has no row for it at
 * all (fire-once seeding, same pattern as ensureSoldUpdateTemplate).
 * PENDING/REJECTED/DRAFT rows are left alone so a rejection never loops.
 */
export function ensureOccasionGreetingTemplate(
  accountId: string
): Promise<OccasionGreetingTemplateState> {
  return ensureSharedTemplate(
    accountId,
    OCCASION_GREETING_TEMPLATE_NAME,
    buildOccasionGreetingTemplatePayload,
    'occasion-greeting'
  );
}
