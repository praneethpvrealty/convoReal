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
import { BRANDING } from '@/config/branding';

interface PageProps {
  params: Promise<{ destination: string }>;
  searchParams: Promise<{ account_id?: string; ref?: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { destination: slug } = await params;
  const destination = getFarmlandDestination(slug);
  if (!destination) return { title: `Farm Lands | ${BRANDING.name}` };

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl
  ).replace(/\/$/, '');
  const title = `Farm Lands in ${destination.name} (${destination.region}) | ${BRANDING.name}`;

  return {
    title,
    description: destination.metaDescription,
    alternates: { canonical: `${siteUrl}/farmland/${destination.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description: destination.metaDescription,
      type: 'website',
      url: `${siteUrl}/farmland/${destination.slug}`,
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

  const reqHeaders = await headers();
  const subdomain = resolveSubdomainFromHost(reqHeaders.get('host') || '');

  let accountId: string | null = null;
  const ref = resolvedParams.account_id || resolvedParams.ref;
  if (ref && UUID_RE.test(ref)) accountId = ref;
  if (!accountId && subdomain)
    accountId = await cachedResolveAccountFromSubdomain(subdomain);
  if (!accountId)
    accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
  if (!accountId) accountId = await cachedFetchFallbackAccount();
  if (!accountId) notFound();

  const { settings, properties, agents, profiles } =
    await cachedFetchShowcaseData(accountId, false);

  const destinationProperties = toPublicProperties(
    properties.filter((p) => matchesFarmlandDestination(p, destination)),
    agents,
    profiles,
    false
  );

  return (
    <ShowcaseView
      properties={destinationProperties}
      settings={settings}
      accountId={accountId}
      hero={{
        title: destination.headline,
        highlight: destination.name,
        subtitle: destination.subtitle,
        badges: destination.highlights,
      }}
      initialTheme={destination.theme}
      disableSavedState
    />
  );
}
