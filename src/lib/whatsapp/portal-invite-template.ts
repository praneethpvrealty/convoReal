// The "property_portal_invite" pair: the Marketing templates the contact
// record's Share Portal action sends when the 24-hour window is closed.
// One for a buyer, one for a co-broker in agent view; both mirror the
// free-text invite word for word, with the attributed portal link in
// the URL button. Before these existed the closed-window path borrowed
// property_selection_update, whose body is an inventory digest and never
// mentions the portal.

import { BRANDING } from '@/config/branding';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import { categoryForType } from '@/lib/inventory-summary-builder';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import {
  templateBody,
  templateButtonLabel,
  templateFooter,
} from '@/lib/whatsapp/template-copy';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import type { Property } from '@/types';

export const PORTAL_INVITE_TEMPLATE_NAME = 'property_portal_invite';
export const PORTAL_AGENT_INVITE_TEMPLATE_NAME = 'property_portal_agent_invite';

export type PortalInviteTemplateAudience = 'buyer' | 'agent';

const NAME_MAX_LENGTH = 60;
const SENDER_MAX_LENGTH = 120;
const SCOPE_MAX_LENGTH = 200;
const FALLBACK_SELECTION_MAX_LENGTH = 600;

export function portalInviteTemplateName(
  audience: PortalInviteTemplateAudience
): string {
  return audience === 'agent'
    ? PORTAL_AGENT_INVITE_TEMPLATE_NAME
    : PORTAL_INVITE_TEMPLATE_NAME;
}

function buildPayload(
  audience: PortalInviteTemplateAudience,
  origin: string,
  language: LanguageCode
): TemplatePayload {
  const copyKey =
    audience === 'agent' ? 'portal_invite_agent' : 'portal_invite';
  return {
    name: portalInviteTemplateName(audience),
    category: 'Marketing',
    language: metaLanguageCode(language),
    body_text: templateBody(copyKey, language),
    footer_text: templateFooter(copyKey, language),
    buttons: [
      {
        type: 'URL',
        text: templateButtonLabel('open_portal', language),
        url: `${origin.replace(/\/+$/, '')}/{{1}}`,
        example: '?ref=account-id&v=contact-id',
      },
    ],
    sample_values: {
      body: [
        'Praneeth',
        'Lakshmi from Aryavarta Ventures',
        audience === 'agent'
          ? 'It already opens on apartments for sale in Koramangala — clear the filters to see the full inventory.'
          : 'It already opens on apartments for sale in Koramangala for you — change the filters any time to widen the search.',
      ],
    },
  };
}

export function buildPortalInviteTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return buildPayload('buyer', origin, language);
}

export function buildPortalAgentInviteTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return buildPayload('agent', origin, language);
}

export interface PortalInviteTemplateInput {
  contactName?: string | null;
  agentName?: string | null;
  brandName?: string | null;
  /** `describePortalInviteFilters()` output: "vacant plot for sale in BTM 2nd Stage". */
  scope?: string | null;
  audience: PortalInviteTemplateAudience;
}

const clean = (value?: string | null) => value?.trim() || '';

export function portalInviteSenderLabel(
  agentName?: string | null,
  brandName?: string | null
): string {
  const agent = clean(agentName);
  const brand = clean(brandName);
  if (agent && brand) return `${agent} from ${brand}`;
  return agent || brand || BRANDING.name;
}

export function portalInviteScopeLine(
  scope: string | null | undefined,
  audience: PortalInviteTemplateAudience
): string {
  const focus = clean(scope);
  if (audience === 'agent') {
    return focus
      ? `It already opens on ${focus} — clear the filters to see the full inventory.`
      : 'Every listing is there — filter it down for each client.';
  }
  return focus
    ? `It already opens on ${focus} for you — change the filters any time to widen the search.`
    : 'Use the filters at the top to narrow it down to exactly what you are looking for.';
}

/** Body params {{1}}..{{3}} of either portal invite template. */
export function buildPortalInviteTemplateParams({
  contactName,
  agentName,
  brandName,
  scope,
  audience,
}: PortalInviteTemplateInput): [name: string, sender: string, scope: string] {
  const rawName = clean(contactName);
  const firstName =
    rawName && !isPlaceholderLeadName(rawName) ? rawName.split(/\s+/)[0] : '';
  return [
    sanitizeTemplateParam(firstName, NAME_MAX_LENGTH) || 'there',
    sanitizeTemplateParam(
      portalInviteSenderLabel(agentName, brandName),
      SENDER_MAX_LENGTH
    ),
    sanitizeTemplateParam(
      portalInviteScopeLine(scope, audience),
      SCOPE_MAX_LENGTH
    ),
  ];
}

/**
 * Body param {{2}} of property_selection_update when an account has that
 * template approved but not the portal invite yet. The old body says
 * "I've selected these properties", so this names what the portal holds
 * and points at the URL button instead of pasting two listings per
 * category and an ellipsis.
 */
export function buildPortalInviteFallbackSelection(
  properties: Pick<Property, 'type'>[],
  scope: string | null | undefined,
  audience: PortalInviteTemplateAudience,
  language: LanguageCode = DEFAULT_LANGUAGE
): string {
  const counts: Record<string, number> = {};
  for (const property of properties) {
    const category = categoryForType(property.type);
    const label =
      category === 'Residential' || category === 'Commercial'
        ? category
        : 'Farm & land';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const total = properties.length;
  const focus = clean(scope);
  const button = templateButtonLabel('browse_showcase', language);
  const inventory = focus
    ? `${focus.charAt(0).toUpperCase()}${focus.slice(1)} and more across ${total} listing${total === 1 ? '' : 's'} on our portal`
    : total > 0
      ? Object.entries(counts)
          .map(
            ([label, count]) =>
              `${label}: ${count} option${count === 1 ? '' : 's'}`
          )
          .join(' • ')
      : 'Every listing we have on our portal';
  const pointer =
    audience === 'agent'
      ? `Tap ${button} below to open the full inventory in agent view, filter it for your clients and forward any listing with your own share link.`
      : `Tap ${button} below to filter by location, budget and property type, shortlist the ones you like and send your enquiry from the portal.`;
  return sanitizeTemplateParam(
    `${inventory}. ${pointer}`,
    FALLBACK_SELECTION_MAX_LENGTH
  );
}
