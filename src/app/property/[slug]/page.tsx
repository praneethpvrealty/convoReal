import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ShowcaseView } from '@/components/showcase/showcase-view';
import {
  cachedFetchShowcaseData,
  cachedResolvePropertyById,
  toPublicProperties,
} from '@/lib/showcase/public-data';
import {
  propertyLookupKeyFromSlug,
  propertySlug,
} from '@/lib/showcase/property-slug';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';
import {
  jsonLdScript,
  breadcrumbJsonLd,
  propertyJsonLd,
} from '@/lib/seo/jsonld';
import {
  isLocationGuarded,
  localityLabel,
} from '@/lib/inventory/location-guard';
import { BRANDING } from '@/config/branding';
import type { Property } from '@/types';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string; mode?: string }>;
}

async function resolveProperty(
  params: PageProps['params']
): Promise<Property | null> {
  const { slug } = await params;
  const lookupKey = propertyLookupKeyFromSlug(slug);
  const accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  return cachedResolvePropertyById(lookupKey, accountId);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const property = await resolveProperty(params);
  if (!property) return { title: `Properties | ${BRANDING.name}` };

  const description =
    (property.description || '').slice(0, 160) ||
    [
      property.type,
      isLocationGuarded(property) ? localityLabel(property) : property.location,
    ]
      .filter(Boolean)
      .join(' · ');

  const origin = await resolveRequestOrigin();
  const canonicalUrl = `${origin}/property/${propertySlug(property)}`;
  const heroImage = `${origin}/api/properties/${property.id}/og-image`;

  return {
    title: property.title,
    description,
    alternates: { canonical: canonicalUrl },
    robots: { index: property.is_published, follow: true },
    openGraph: {
      title: property.title,
      description,
      type: 'website',
      url: canonicalUrl,
      images: [{ url: heroImage }],
    },
    twitter: {
      card: 'summary_large_image',
      title: property.title,
      description,
      images: [heroImage],
    },
  };
}

export default async function PropertyPage({
  params,
  searchParams,
}: PageProps) {
  const [property, { slug }, resolvedParams] = await Promise.all([
    resolveProperty(params),
    params,
    searchParams,
  ]);
  if (!property) notFound();

  // Stale slugs (title edits, bare uuid/code links) 308 to the canonical
  // form so crawlers converge on one URL per listing.
  const canonicalSlug = propertySlug(property);
  if (decodeURIComponent(slug) !== canonicalSlug) {
    const suffix = resolvedParams.v
      ? `?v=${encodeURIComponent(resolvedParams.v)}`
      : '';
    permanentRedirect(`/property/${canonicalSlug}${suffix}`);
  }

  const isAgentMode =
    resolvedParams.mode === 'view' || resolvedParams.mode === 'agent';
  const { settings, properties, agents, profiles } =
    await cachedFetchShowcaseData(property.account_id, isAgentMode);

  const propertiesList = properties.some((p) => p.id === property.id)
    ? properties
    : [property, ...properties];
  const publicProperties = toPublicProperties(
    propertiesList,
    agents,
    profiles,
    isAgentMode
  );

  const origin = await resolveRequestOrigin();
  const canonicalUrl = `${origin}/property/${canonicalSlug}`;
  const siteName = settings?.website_name || BRANDING.name;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            propertyJsonLd(
              property,
              canonicalUrl,
              `${origin}/api/properties/${property.id}/og-image`
            )
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: siteName, url: origin },
              { name: property.title, url: canonicalUrl },
            ])
          ),
        }}
      />
      <ShowcaseView
        properties={publicProperties}
        settings={settings}
        accountId={property.account_id}
        initialPropertyId={property.id}
        initialAgentMode={isAgentMode}
        visitorRef={resolvedParams.v}
      />
    </>
  );
}
