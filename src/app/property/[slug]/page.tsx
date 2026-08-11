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
import {
  isTeaserGated,
  priceBand,
  teaserTitle,
} from '@/lib/inventory/showcase-visibility';
import {
  grantedReveals,
  resolveShareGrant,
  trackGrantView,
} from '@/lib/inventory/share-grants';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { BRANDING } from '@/config/branding';
import type { Property } from '@/types';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string; mode?: string; g?: string }>;
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

  // Metadata is gated without consulting ?g=: this is what a messaging
  // app unfurls when the link is FORWARDED, and an unfurl carries no
  // grant. A teaser listing therefore previews as its stub everywhere,
  // and never appears in an index.
  if (isTeaserGated(property)) {
    const gatedOrigin = await resolveRequestOrigin();
    const band = priceBand(property.price);
    return {
      title: teaserTitle(property),
      description: `Confidential listing — details shared on request.${band ? ` Guide price ${band}.` : ''}`,
      alternates: {
        canonical: `${gatedOrigin}/property/${propertySlug(property)}`,
      },
      robots: { index: false, follow: false },
      openGraph: {
        title: teaserTitle(property),
        description: 'Confidential listing — details shared on request.',
        type: 'website',
        url: `${gatedOrigin}/property/${propertySlug(property)}`,
      },
    };
  }

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
    // The grant rides the redirect too — dropping ?g= here would send a
    // recipient with a live key to the masked page instead.
    const carried = new URLSearchParams();
    if (resolvedParams.v) carried.set('v', resolvedParams.v);
    if (resolvedParams.g) carried.set('g', resolvedParams.g);
    const suffix = carried.size > 0 ? `?${carried}` : '';
    permanentRedirect(`/property/${canonicalSlug}${suffix}`);
  }

  const isAgentMode =
    resolvedParams.mode === 'view' || resolvedParams.mode === 'agent';
  const { settings, accountName, properties, agents, profiles } =
    await cachedFetchShowcaseData(property.account_id, isAgentMode);

  const propertiesList = properties.some((p) => p.id === property.id)
    ? properties
    : [property, ...properties];
  // Share grant (?g=), resolved against this listing so a token lifted
  // from another share cannot widen it. Uncached: revocation has to bite
  // on the next open.
  const shareGrant = resolvedParams.g
    ? await resolveShareGrant(
        supabaseAdmin(),
        resolvedParams.g,
        property.id,
        property.account_id
      )
    : null;
  if (shareGrant) {
    await trackGrantView(supabaseAdmin(), shareGrant);
  }

  const publicProperties = toPublicProperties(
    propertiesList,
    agents,
    profiles,
    isAgentMode,
    shareGrant
      ? {
          propertyId: shareGrant.property_id,
          reveals: grantedReveals(shareGrant),
        }
      : null
  );

  const origin = await resolveRequestOrigin();
  const canonicalUrl = `${origin}/property/${canonicalSlug}`;
  const siteName = accountName || BRANDING.name;

  // Structured data describes the listing to crawlers in the clear, so
  // a teaser emits none of it — the page is noindex anyway.
  const emitJsonLd = !isTeaserGated(property);

  return (
    <>
      {emitJsonLd && (
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
        </>
      )}
      <ShowcaseView
        properties={publicProperties}
        settings={settings}
        accountId={property.account_id}
        siteName={accountName}
        initialPropertyId={property.id}
        initialAgentMode={isAgentMode}
        visitorRef={resolvedParams.v}
        shareGrantToken={shareGrant?.token}
      />
    </>
  );
}
