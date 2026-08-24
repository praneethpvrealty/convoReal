import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ShowcaseView } from '@/components/showcase/showcase-view';
import {
  cachedFetchFallbackAccount,
  cachedFetchShowcaseData,
  cachedResolveAccountFromSubdomain,
  resolveSubdomainFromHost,
  toPublicProperties,
} from '@/lib/showcase/public-data';
import {
  getFarmlandDestination,
  matchesFarmlandDestination,
} from '@/lib/data/farmland-destinations';
import { propertySlug } from '@/lib/showcase/property-slug';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';
import {
  itemListJsonLd,
  jsonLdScript,
  realEstateAgentJsonLd,
} from '@/lib/seo/jsonld';
import { buildPublicBusinessProfile } from '@/lib/seo/business-profile';
import { BRANDING } from '@/config/branding';

interface PageProps {
  params: Promise<{ destination: string }>;
  searchParams: Promise<{ account_id?: string; ref?: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAccountId(
  searchParams: PageProps['searchParams']
): Promise<string | null> {
  const resolvedParams = await searchParams;
  const reqHeaders = await headers();
  const subdomain = resolveSubdomainFromHost(reqHeaders.get('host') || '');
  const ref = resolvedParams.account_id || resolvedParams.ref;

  let accountId = ref && UUID_RE.test(ref) ? ref : null;
  if (!accountId && subdomain)
    accountId = await cachedResolveAccountFromSubdomain(subdomain);
  if (!accountId)
    accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  if (!accountId) accountId = await cachedFetchFallbackAccount();
  return accountId;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { destination: slug } = await params;
  const destination = getFarmlandDestination(slug);
  if (!destination) return { title: `Farm Lands | ${BRANDING.name}` };

  const origin = await resolveRequestOrigin();
  const accountId = await resolveAccountId(searchParams);
  const accountName = accountId
    ? (await cachedFetchShowcaseData(accountId, false)).accountName
    : null;
  const title = `Farm Lands in ${destination.name} (${destination.region}) | ${accountName || BRANDING.name}`;

  return {
    title: { absolute: title },
    description: destination.metaDescription,
    alternates: { canonical: `${origin}/farmland/${destination.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description: destination.metaDescription,
      type: 'website',
      url: `${origin}/farmland/${destination.slug}`,
    },
    twitter: {
      card: 'summary',
      title,
      description: destination.metaDescription,
    },
  };
}

export default async function FarmlandDestinationPage({
  params,
  searchParams,
}: PageProps) {
  const [{ destination: slug }, resolvedParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const destination = getFarmlandDestination(slug);
  if (!destination) notFound();

  const accountId = await resolveAccountId(Promise.resolve(resolvedParams));
  if (!accountId) notFound();

  const { settings, accountName, properties, agents, profiles } =
    await cachedFetchShowcaseData(accountId, false);

  const destinationProperties = toPublicProperties(
    properties.filter((p) => matchesFarmlandDestination(p, destination)),
    agents,
    profiles,
    false
  );

  const origin = await resolveRequestOrigin();
  const siteName = accountName || BRANDING.name;
  const businessProfile = buildPublicBusinessProfile(siteName, properties, {
    description: settings?.public_business_description,
    areasServed: settings?.public_areas_served,
    propertyTypes: settings?.public_property_expertise,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            realEstateAgentJsonLd({
              name: siteName,
              url: origin,
              telephone: settings?.contact_phone,
              profile: businessProfile,
            })
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            itemListJsonLd(
              `Farm Lands in ${destination.name}`,
              destinationProperties.map((p) => ({
                name: p.title,
                url: `${origin}/property/${propertySlug(p)}`,
              }))
            )
          ),
        }}
      />
      <ShowcaseView
        properties={destinationProperties}
        settings={settings}
        accountId={accountId}
        siteName={accountName}
        hero={{
          title: destination.headline,
          highlight: destination.name,
          subtitle: destination.subtitle,
          badges: destination.highlights,
        }}
        initialTheme={destination.theme}
        disableSavedState
      />
    </>
  );
}
