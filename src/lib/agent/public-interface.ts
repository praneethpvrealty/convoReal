import { BRANDING } from '@/config/branding';
import {
  isTeaserGated,
  teaserTitle,
  toPublicListingView,
} from '@/lib/inventory/showcase-visibility';
import { isLocationGuarded } from '@/lib/inventory/location-guard';
import {
  cachedFetchFallbackAccount,
  cachedFetchShowcaseData,
  cachedResolveAccountFromSubdomain,
  cachedResolveShowcaseRef,
  resolveSubdomainFromHost,
} from '@/lib/showcase/public-data';
import { propertySlug } from '@/lib/showcase/property-slug';
import {
  buildPublicBusinessProfile,
  type PublicBusinessProfile,
} from '@/lib/seo/business-profile';
import type { Property } from '@/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePublicAgentAccount(
  request: Request
): Promise<string | null> {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  const tenant = url.searchParams.get('__tenant');
  const subdomain =
    resolveSubdomainFromHost(host) ||
    (tenant
      ? resolveSubdomainFromHost(
          `${tenant.toLowerCase()}.${BRANDING.baseDomain}`
        )
      : null);

  if (subdomain) {
    const accountId = await cachedResolveAccountFromSubdomain(subdomain);
    if (accountId) return accountId;
    return null;
  }

  const ref = url.searchParams.get('account_id') || url.searchParams.get('ref');
  if (ref) {
    if (!UUID_RE.test(ref)) return null;
    const resolved = await cachedResolveShowcaseRef(ref);
    return resolved?.accountId ?? null;
  }

  return (
    process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID ||
    (await cachedFetchFallbackAccount())
  );
}

export function publicRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  const protocol =
    request.headers.get('x-forwarded-proto') || url.protocol.slice(0, -1);
  return `${protocol}://${host}`;
}

export async function loadPublicAgentContext(request: Request) {
  const accountId = await resolvePublicAgentAccount(request);
  if (!accountId) return null;
  const data = await cachedFetchShowcaseData(accountId, false);
  const businessName = data.accountName || BRANDING.name;
  return {
    accountId,
    origin: publicRequestOrigin(request),
    businessName,
    profile: buildPublicBusinessProfile(businessName, data.properties, {
      description: data.settings?.public_business_description,
      areasServed: data.settings?.public_areas_served,
      propertyTypes: data.settings?.public_property_expertise,
    }),
    properties: data.properties,
  };
}

function accountQuery(accountId: string): string {
  return `account_id=${encodeURIComponent(accountId)}`;
}

export function buildPublicAgentOpenApi({
  origin,
  accountId,
  businessName,
  description,
  requiresCatalogApiKey,
}: {
  origin: string;
  accountId: string;
  businessName: string;
  description: string;
  requiresCatalogApiKey: boolean;
}) {
  const catalogSecurity = requiresCatalogApiKey ? [{ ApiKeyAuth: [] }] : [];
  return {
    openapi: '3.1.0',
    info: {
      title: `${businessName} property agent API`,
      version: '1.0.0',
      description,
    },
    servers: [{ url: origin }],
    paths: {
      '/api/public/agent/feed': {
        get: {
          operationId: 'searchPublishedProperties',
          summary: 'Search current brokerage-published properties',
          description:
            'Returns only published, currently available inventory. Exact locations, private media, documents and confidential listing details remain withheld by server-side privacy rules.',
          security: catalogSecurity,
          parameters: [
            {
              name: 'account_id',
              in: 'query',
              required: true,
              schema: { type: 'string', const: accountId },
            },
            {
              name: 'search',
              in: 'query',
              description:
                'Natural-language search such as “commercial property in JP Nagar under 5 crore”.',
              schema: { type: 'string', maxLength: 300 },
            },
            {
              name: 'type',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'location',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'min_price',
              in: 'query',
              schema: { type: 'number', minimum: 0 },
            },
            {
              name: 'max_price',
              in: 'query',
              schema: { type: 'number', minimum: 0 },
            },
            {
              name: 'page',
              in: 'query',
              schema: { type: 'integer', minimum: 0, default: 0 },
            },
            {
              name: 'limit',
              in: 'query',
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 50,
                default: 12,
              },
            },
          ],
          responses: {
            '200': {
              description: 'Current matching listings and provenance metadata.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PropertyFeed' },
                },
              },
            },
          },
        },
      },
      '/api/public/catalog-ask': {
        post: {
          operationId: 'askAboutPublishedProperties',
          summary: 'Ask a grounded question about the live catalog',
          description:
            'Answers only from current published inventory. Some open-ended questions require a visitor phone number before the brokerage-funded AI path is used.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['account_id', 'question', 'session_key'],
                  properties: {
                    account_id: { type: 'string', const: accountId },
                    question: { type: 'string', minLength: 1, maxLength: 500 },
                    session_key: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 64,
                    },
                    visitor_phone: { type: 'string' },
                    visitor_name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                'Grounded answer, a request for phone capture, or a handoff instruction.',
            },
          },
        },
      },
      '/api/public/inquiry': {
        post: {
          operationId: 'createPropertyEnquiry',
          summary:
            'Create a consented property enquiry for brokerage follow-up',
          description:
            'Call only after the person explicitly agrees that the brokerage may contact them. This creates a CRM lead, inbox entry and follow-up task.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'accountId',
                    'phone',
                    'source',
                    'consentToContact',
                  ],
                  properties: {
                    accountId: { type: 'string', const: accountId },
                    phone: { type: 'string' },
                    name: { type: 'string', maxLength: 120 },
                    email: { type: 'string', format: 'email' },
                    propertyId: { type: 'string' },
                    propertyTitle: { type: 'string' },
                    propertyCode: { type: 'string' },
                    message: { type: 'string', maxLength: 2000 },
                    sessionKey: { type: 'string', maxLength: 64 },
                    source: { type: 'string', const: 'ai_agent' },
                    consentToContact: { type: 'boolean', const: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Enquiry accepted.' },
            '400': {
              description: 'Invalid request or explicit consent missing.',
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
      schemas: {
        PropertyFeed: {
          type: 'object',
          required: ['data', 'pagination', 'meta'],
          properties: {
            data: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            pagination: { type: 'object', additionalProperties: true },
            meta: {
              type: 'object',
              properties: {
                source: {
                  type: 'string',
                  const: 'brokerage_published_inventory',
                },
                generated_at: { type: 'string', format: 'date-time' },
                latest_result_update: {
                  type: ['string', 'null'],
                  format: 'date-time',
                },
              },
            },
          },
        },
      },
    },
  };
}

function oneLine(value: string | null | undefined): string {
  return (value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function markdownLabel(value: string): string {
  return oneLine(value).replace(/[\[\]]/g, '');
}

function priceLabel(property: Property): string | null {
  const price =
    property.listing_type === 'Rent' ? property.rent_per_month : property.price;
  if (!price)
    return (property as Property & { price_band?: string }).price_band || null;
  const suffix = property.listing_type === 'Rent' ? '/month' : '';
  return `₹${price.toLocaleString('en-IN')}${suffix}`;
}

export function buildLlmsText({
  origin,
  accountId,
  businessName,
  profile,
  properties,
}: {
  origin: string;
  accountId: string;
  businessName: string;
  profile: PublicBusinessProfile;
  properties: Property[];
}): string {
  const query = accountQuery(accountId);
  const lines = [
    `# ${oneLine(businessName)}`,
    '',
    `> ${oneLine(profile.description)}`,
    '',
    'Use the live feed before answering availability questions. Inventory is brokerage-published and may change; never invent listings or treat publication as independent legal verification. Exact locations, private media and documents may be withheld.',
    '',
    '## Agent interfaces',
    '',
    `- [Current property feed](${origin}/api/public/agent/feed?${query}): Search current published and available inventory.`,
    `- [OpenAPI contract](${origin}/api/public/agent/openapi.json?${query}): Machine-readable search, grounded Q&A and consented enquiry actions.`,
    `- [Human property showcase](${origin}/?ref=${encodeURIComponent(accountId)}): Browse the current catalog.`,
    '',
    '## Current published properties',
    '',
  ];

  const publicProperties = properties
    .filter((property) => !isTeaserGated(property))
    .slice(0, 50)
    .map((property) => {
      const view = toPublicListingView(property, { revealExact: false });
      const title = isLocationGuarded(property)
        ? teaserTitle(property)
        : view.title;
      const url = isLocationGuarded(property)
        ? `${origin}/?property_id=${encodeURIComponent(property.id)}&ref=${encodeURIComponent(accountId)}`
        : `${origin}/property/${propertySlug(property)}`;
      const details = [
        view.type,
        view.listing_type ? `for ${view.listing_type}` : null,
        view.location,
        priceLabel(view),
        view.updated_at ? `updated ${view.updated_at.slice(0, 10)}` : null,
      ].filter(Boolean);
      return `- [${markdownLabel(title)}](${url}): ${details.map((value) => oneLine(String(value))).join(' · ')}`;
    });

  lines.push(
    ...(publicProperties.length
      ? publicProperties
      : ['- No published properties are currently available.']),
    ''
  );
  return lines.join('\n');
}
