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
  portalInvitePhrase,
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
  /** The language of the template variant being filled, so the
   *  parameters read in the same language as the body around them. */
  language?: LanguageCode;
}

const clean = (value?: string | null) => value?.trim() || '';

export function portalInviteSenderLabel(
  agentName?: string | null,
  brandName?: string | null,
  language: LanguageCode = DEFAULT_LANGUAGE
): string {
  const agent = clean(agentName);
  const brand = clean(brandName);
  if (agent && brand) {
    return portalInvitePhrase('sender_from', language, { agent, brand });
  }
  return agent || brand || BRANDING.name;
}

export function portalInviteScopeLine(
  scope: string | null | undefined,
  audience: PortalInviteTemplateAudience,
  language: LanguageCode = DEFAULT_LANGUAGE
): string {
  const focus = clean(scope);
  if (audience === 'agent') {
    return focus
      ? portalInvitePhrase('agent_scope', language, { scope: focus })
      : portalInvitePhrase('agent_no_scope', language);
  }
  return focus
    ? portalInvitePhrase('buyer_scope', language, { scope: focus })
    : portalInvitePhrase('buyer_no_scope', language);
}

/** Body params {{1}}..{{3}} of either portal invite template. */
export function buildPortalInviteTemplateParams({
  contactName,
  agentName,
  brandName,
  scope,
  audience,
  language = DEFAULT_LANGUAGE,
}: PortalInviteTemplateInput): [name: string, sender: string, scope: string] {
  const rawName = clean(contactName);
  const firstName =
    rawName && !isPlaceholderLeadName(rawName) ? rawName.split(/\s+/)[0] : '';
  return [
    sanitizeTemplateParam(firstName, NAME_MAX_LENGTH) || 'there',
    sanitizeTemplateParam(
      portalInviteSenderLabel(agentName, brandName, language),
      SENDER_MAX_LENGTH
    ),
    sanitizeTemplateParam(
      portalInviteScopeLine(scope, audience, language),
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
  const lead = focus
    ? portalInvitePhrase('fallback_focus', language, {
        scope: focus,
        count: total,
      })
    : total > 0
      ? Object.entries(counts)
          .map(
            ([label, count]) =>
              `${label}: ${count} option${count === 1 ? '' : 's'}`
          )
          .join(' • ')
      : portalInvitePhrase('fallback_all', language);
  const inventory = `${lead.charAt(0).toUpperCase()}${lead.slice(1)}`;
  const pointer = portalInvitePhrase(
    audience === 'agent' ? 'fallback_agent_pointer' : 'fallback_buyer_pointer',
    language,
    { button }
  );
  return sanitizeTemplateParam(
    `${inventory}. ${pointer}`,
    FALLBACK_SELECTION_MAX_LENGTH
  );
}
