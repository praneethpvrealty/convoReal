// ============================================================
// Inventory tools: search, fetch, and "who wants this listing".
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ConvoRealClient } from '../client.js';
import { toToolError } from '../errors.js';
import {
  bullets,
  formatDate,
  formatMoney,
  renderPage,
  renderRecord,
  type PageEnvelope,
} from '../format.js';
import { idField, paginationFields, responseFormatField } from '../schemas.js';
import type { ContactMatch, V1Property, V1PropertyDetail } from '../types.js';

/** One listing as a markdown block. Shared by search and match results
 *  so a property reads the same wherever it appears. */
export function propertyLine(p: V1Property): string {
  const facts = [
    p.type,
    p.bedrooms ? `${p.bedrooms} BHK` : null,
    p.area_sqft ? `${p.area_sqft.toLocaleString('en-IN')} sqft` : null,
    p.location,
  ]
    .filter(Boolean)
    .join(' · ');

  const price =
    p.listing_type === 'Rent' && p.rent_per_month
      ? `${formatMoney(p.rent_per_month)}/mo`
      : formatMoney(p.price);

  return [
    `## ${p.title} — ${price}`,
    facts,
    bullets([
      ['Id', p.id],
      ['Status', p.status],
      ['Listing', p.listing_type],
      ['Project', p.project],
      ['Yield', p.roi ? `${p.roi}%` : null],
      ['Published', p.is_published ? 'yes' : 'no'],
    ]),
  ]
    .filter(Boolean)
    .join('\n');
}

const SearchInput = z
  .object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Free text matched against title, locality, city and project name. Omit to browse everything.'
      ),
    city: z
      .string()
      .max(100)
      .optional()
      .describe('Filter by city, partial match.'),
    type: z
      .string()
      .max(100)
      .optional()
      .describe(
        "Exact property type, e.g. 'Flat/ Apartment', 'Villa', 'Residential Land/ Plot'. Must match exactly — use `query` if unsure."
      ),
    listing_type: z
      .enum(['Sale', 'Rent', 'JV/JD', 'Built to Suit'])
      .optional()
      .describe('Deal type.'),
    status: z
      .string()
      .max(50)
      .optional()
      .describe(
        'Exact status: Available, Under Contract, Sold, Archived, Off Market, Pending Review, Rejected.'
      ),
    min_price: z
      .number()
      .min(0)
      .optional()
      .describe('Minimum price in rupees (not lakhs/crores).'),
    max_price: z
      .number()
      .min(0)
      .optional()
      .describe('Maximum price in rupees (not lakhs/crores).'),
    bedrooms: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe('Exact bedroom count.'),
    published: z
      .boolean()
      .optional()
      .describe('Only listings published to the public showcase.'),
    sort: z
      .enum(['recent', 'oldest', 'price_asc', 'price_desc'])
      .default('recent')
      .describe('Result ordering.'),
    ...paginationFields,
  })
  .strict();

const GetInput = z
  .object({
    property_id: idField('property'),
    response_format: responseFormatField,
  })
  .strict();

const MatchInput = z
  .object({
    property_id: idField('property'),
    min_score: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'Only return matches at or above this score. 60 is the threshold the app uses.'
      ),
    ...paginationFields,
  })
  .strict();

export function registerPropertyTools(
  server: McpServer,
  client: ConvoRealClient
): void {
  server.registerTool(
    'convoreal_search_properties',
    {
      title: 'Search property inventory',
      description: `Search the workspace's property inventory by text, location, price band, type and status.

Prices are in RUPEES, not lakhs or crores — "under 1.5 crore" is max_price: 15000000.

Returns a page of listings: id, title, price, location, type, bedrooms, area, status, and whether it is published to the public showcase.

Examples:
  - "3BHK flats in Kokapet under 2 Cr" -> query: "Kokapet", bedrooms: 3, max_price: 20000000
  - "what land do we have for JV" -> listing_type: "JV/JD"
  - "cheapest available villas" -> query: "villa", status: "Available", sort: "price_asc"

Use convoreal_get_property for one listing's full record, and
convoreal_match_contacts_for_property to find buyers for one.`,
      inputSchema: SearchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<V1Property>>('/properties', {
          q: params.query,
          city: params.city,
          type: params.type,
          listing_type: params.listing_type,
          status: params.status,
          min_price: params.min_price,
          max_price: params.max_price,
          bedrooms: params.bedrooms,
          published: params.published,
          sort: params.sort,
          limit: params.limit,
          offset: params.offset,
        });

        return renderPage({
          title: 'Properties',
          page: data,
          renderItem: propertyLine,
          emptyHint:
            'Try fewer filters — drop the price band or use a broader `query` such as just the locality name.',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_get_property',
    {
      title: 'Get one property',
      description: `Fetch a single listing in full, including its description, area breakdown, per-sqft rate, possession date and rental figures.

Takes a property id (UUID) — get one from convoreal_search_properties.

Returns the complete record for that listing, or an error if no listing with that id exists in this workspace.`,
      inputSchema: GetInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ property_id, response_format }) => {
      try {
        const { property } = await client.get<{ property: V1PropertyDetail }>(
          `/properties/${property_id}`
        );

        const body = [
          bullets([
            ['Id', property.id],
            ['Price', formatMoney(property.price)],
            [
              'Rate',
              property.price_per_sqft
                ? `${formatMoney(property.price_per_sqft)}/sqft`
                : null,
            ],
            [
              'Rent',
              property.rent_per_month
                ? `${formatMoney(property.rent_per_month)}/mo`
                : null,
            ],
            [
              'Location',
              [property.location, property.city, property.state]
                .filter(Boolean)
                .join(', '),
            ],
            ['Project', property.project],
            ['Type', property.type],
            ['Listing', property.listing_type],
            ['Status', property.status],
            ['Bedrooms', property.bedrooms],
            ['Bathrooms', property.bathrooms],
            [
              'Area',
              property.area_sqft
                ? `${property.area_sqft.toLocaleString('en-IN')} ${property.area_unit ?? 'sqft'}`
                : null,
            ],
            [
              'Land',
              property.land_area
                ? `${property.land_area} ${property.land_area_unit ?? ''}`.trim()
                : null,
            ],
            ['Yield', property.roi ? `${property.roi}%` : null],
            ['Possession', formatDate(property.possession_date)],
            ['Published', property.is_published ? 'yes' : 'no'],
          ]),
          property.description
            ? `\n### Description\n\n${property.description}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        return renderRecord(
          property.title,
          body,
          property as unknown as Record<string, unknown>,
          response_format
        );
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_match_contacts_for_property',
    {
      title: 'Find buyers for a property',
      description: `Rank the workspace's buyer and agent contacts against one listing, best fit first.

This runs ConvoReal's own matching engine — the same scoring the inventory screen, the share dialog and Match Radar use — so the ranking here agrees with what the agent sees in the app. It weighs property type, locality, budget, bedroom count, rental yield and named projects of interest.

Each result carries a score (0-100), a per-field verdict (match / partial / unknown / mismatch) and plain-language reasons.

Use this to answer "who should I send this to?". Scores below 60 are weak fits — pass min_score: 60 to see only the ones the app itself would surface.

This tool does NOT message anyone; it only ranks. Sending remains a deliberate action in the app.`,
      inputSchema: MatchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<
          PageEnvelope<ContactMatch> & { property_id: string }
        >(`/properties/${params.property_id}/matches`, {
          min_score: params.min_score,
          limit: params.limit,
          offset: params.offset,
        });

        return renderPage({
          title: 'Matching contacts',
          page: data,
          renderItem: (m) =>
            [
              `## ${m.contact.name ?? '(unnamed)'} — score ${m.score}`,
              m.reasons.length ? m.reasons.join(' · ') : 'No strong signals',
              bullets([
                ['Id', m.contact.id],
                ['Phone', m.contact.phone],
                ['Type', m.contact.classification],
                ['Lead', m.contact.lead_temp],
                [
                  'Budget',
                  m.contact.budget.unconstrained
                    ? 'no constraint'
                    : m.contact.budget.min || m.contact.budget.max
                      ? `${formatMoney(m.contact.budget.min)} – ${formatMoney(m.contact.budget.max)}`
                      : null,
                ],
                ['Requirement', m.contact.requirements],
              ]),
            ]
              .filter(Boolean)
              .join('\n'),
          emptyHint:
            'No contact fits this listing. Lower min_score, or check the workspace has buyers with stated budgets and areas (convoreal_search_contacts with has_requirement).',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
