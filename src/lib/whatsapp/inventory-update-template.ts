// The predefined "property_selection_update" WhatsApp template + its per-send
// parameter builders. This is the Engine-native counterpart of the
// showcase share dialog's inventory digest: instead of pasting the
// digest into personal WhatsApp, the agent sends this pre-approved
// Marketing template from their WhatsApp Business number, so replies
// land in the ConvoReal Inbox (24h window opens → AI copilot engages,
// everything is tracked). One-click submitted via
// /api/whatsapp/templates/submit; pure functions so the exact payload
// and parameters are unit-testable.

import type { Contact, Property } from '@/types';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import {
  templateBody,
  templateFooter,
  templateButtonLabel,
} from '@/lib/whatsapp/template-copy';
import { formatShareAmount } from '@/lib/share-message-builder';
import {
  bedroomSegment,
  categoryForType,
} from '@/lib/inventory-summary-builder';
import { rankInventoryProperties } from '@/lib/inventory/top-properties';

export const PROPERTY_SELECTION_UPDATE_TEMPLATE_NAME =
  'property_selection_update';

// Meta rejects body parameters containing newlines, tabs, or 4+
// consecutive spaces; the rendered body must also stay inside the
// 1024-char cap, so each parameter gets a hard budget.
const PARAM_MAX_LENGTH = 200;
const SELECTION_PARAM_MAX_LENGTH = 600;

export function sanitizeTemplateParam(
  value: string,
  maxLength = PARAM_MAX_LENGTH
): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(' ');
  const wordCut = space > maxLength * 0.6 ? cut.slice(0, space) : cut;
  return `${wordCut.replace(/[\s,·•(—-]+$/, '')}…`;
}

/**
 * Template definition submitted to Meta. `origin` becomes the URL
 * button's base (the tenant's own showcase domain); the dynamic
 * suffix carries `?ref=<account>&v=<contact>` at send time so every
 * click is attributed by name in Showcase Pulse.
 */
export function buildInventoryUpdateTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: PROPERTY_SELECTION_UPDATE_TEMPLATE_NAME,
    category: 'Marketing',
    language: metaLanguageCode(language),
    body_text: templateBody('inventory_update', language),
    footer_text: templateFooter('inventory_update', language),
    buttons: [
      // Quick replies first (Meta: QR block cannot follow CTA buttons).
      // A tap opens the 24h service window → the full digest / copilot
      // conversation continues free-form inside ConvoReal.
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('inventory_full_list', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('site_visit', language),
      },
      {
        type: 'URL',
        text: templateButtonLabel('browse_showcase', language),
        url: `${origin.replace(/\/+$/, '')}/{{1}}`,
        example: '?ref=account-id&v=contact-id',
      },
    ],
    sample_values: {
      body: [
        'Praneeth',
        'Commercial: 2 options — Prestige Office (₹6.30 Lakhs/mo rent), Oval Reef Warehouse (₹9 Cr · ROI 6%)',
      ],
    },
  };
}

function itemLabel(p: Property): string {
  const bits: string[] = [];
  const bedrooms = bedroomSegment(p);
  if (bedrooms) bits.push(bedrooms);
  if (p.listing_type === 'Rent') {
    const rent = formatShareAmount(p.rent_per_month);
    if (rent) bits.push(`${rent}/mo rent`);
  } else {
    const price = formatShareAmount(p.price);
    if (price) bits.push(price);
    if (p.roi && p.roi > 0) bits.push(`ROI ${p.roi}%`);
  }
  return bits.length > 0
    ? `${p.title.trim()} (${bits.join(' · ')})`
    : p.title.trim();
}

function plural(count: number, word: string, suffix = 's'): string {
  return `${count} ${word}${count === 1 ? '' : suffix}`;
}

function categoryLineWith(
  list: Property[],
  matches: Property[],
  personalized: boolean,
  shownCount: number
): string {
  const pool = personalized && matches.length === 0 ? list : matches;
  const shown = pool.slice(0, shownCount).map(itemLabel).join(', ');
  const hidden = pool.length - Math.min(pool.length, shownCount);
  let lead: string;
  let trailer: string;
  if (personalized && matches.length === 0) {
    lead = `${list.length} available, closest options`;
    trailer = hidden > 0 ? `+${hidden} more` : '';
  } else if (personalized) {
    lead = `${plural(matches.length, 'match', 'es')} from ${list.length} available`;
    const otherOptions = list.length - matches.length;
    trailer = [
      hidden > 0 ? `+${plural(hidden, 'more match', 'es')}` : '',
      otherOptions > 0 ? plural(otherOptions, 'other option') : '',
    ]
      .filter(Boolean)
      .join(' · ');
  } else {
    lead = plural(list.length, 'option');
    trailer = hidden > 0 ? `+${hidden} more` : '';
  }
  const body = shown ? `${lead} — ${shown}` : lead;
  return [body, trailer].filter(Boolean).join(' ');
}

function categoryLine(
  list: Property[],
  matchedPropertyIds: Set<string>,
  personalized: boolean,
  maxLength = PARAM_MAX_LENGTH
): string {
  if (list.length === 0) return 'no published options right now';
  const matches = personalized
    ? list.filter((property) => matchedPropertyIds.has(property.id))
    : list;
  for (const shownCount of [2, 1]) {
    const line = categoryLineWith(list, matches, personalized, shownCount);
    if (line.length <= maxLength) return line;
  }
  return sanitizeTemplateParam(
    categoryLineWith(list, matches, personalized, 1),
    maxLength
  );
}

/**
 * Body params {{2}}..{{4}}: one single-line snapshot per section.
 * Agricultural and anything uncategorised share the third line.
 */
export function buildInventoryUpdateParams(
  properties: Property[],
  contact?: Contact | null,
  { preserveOrder = false }: { preserveOrder?: boolean } = {}
): [residential: string, commercial: string, farmAndLand: string] {
  const ranking = rankInventoryProperties(properties, contact, {
    preserveOrder,
  });
  const residential: Property[] = [];
  const commercial: Property[] = [];
  const farmAndLand: Property[] = [];
  for (const p of ranking.properties) {
    const cat = categoryForType(p.type);
    if (cat === 'Residential') residential.push(p);
    else if (cat === 'Commercial') commercial.push(p);
    else farmAndLand.push(p);
  }
  return [
    categoryLine(residential, ranking.matchedPropertyIds, ranking.personalized),
    categoryLine(commercial, ranking.matchedPropertyIds, ranking.personalized),
    categoryLine(farmAndLand, ranking.matchedPropertyIds, ranking.personalized),
  ];
}

/**
 * Body param {{2}} of property_selection_update. Only categories present in
 * the chosen share scope are named, so a commercial selection never mentions
 * residential or farm inventory. The legacy three-param builder above stays
 * in the API response for older mobile releases using inventory_update.
 */
export function buildPropertySelectionUpdateParams(
  properties: Property[],
  contact?: Contact | null,
  { preserveOrder = false }: { preserveOrder?: boolean } = {}
): [selection: string] {
  const ranking = rankInventoryProperties(properties, contact, {
    preserveOrder,
  });
  const groups: Record<
    'Residential' | 'Commercial' | 'Farm & land' | 'Other',
    Property[]
  > = {
    Residential: [],
    Commercial: [],
    'Farm & land': [],
    Other: [],
  };

  for (const property of ranking.properties) {
    const category = categoryForType(property.type);
    if (category === 'Residential') groups.Residential.push(property);
    else if (category === 'Commercial') groups.Commercial.push(property);
    else if (category === 'Agricultural') groups['Farm & land'].push(property);
    else groups.Other.push(property);
  }

  const onlyMatched = ranking.personalized && ranking.matchCount > 0;
  const sections = Object.entries(groups).filter(
    ([, list]) =>
      list.length > 0 &&
      (!onlyMatched ||
        list.some((property) => ranking.matchedPropertyIds.has(property.id)))
  );
  const separator = ' • ';
  const budget = Math.floor(
    (SELECTION_PARAM_MAX_LENGTH - separator.length * (sections.length - 1)) /
      Math.max(sections.length, 1)
  );
  const selection = sections
    .map(
      ([label, list]) =>
        `${label}: ${categoryLine(
          list,
          ranking.matchedPropertyIds,
          ranking.personalized,
          budget - label.length - 2
        )}`
    )
    .join(separator);

  return [
    sanitizeTemplateParam(
      selection || 'No published options in this selection right now',
      SELECTION_PARAM_MAX_LENGTH
    ),
  ];
}
