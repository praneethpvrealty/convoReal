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
  type ShowcaseData,
} from '@/lib/showcase/public-data';
import { findProjectProperties } from '@/lib/inventory/project-slug';
import { BRANDING } from '@/config/branding';
import type { Property } from '@/types';

interface PageProps {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ account_id?: string; ref?: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedProject {
  accountId: string;
  data: ShowcaseData;
  projectName: string;
  projectProperties: Property[];
}

async function resolveProject(
  params: PageProps['params'],
  searchParams: PageProps['searchParams']
): Promise<ResolvedProject | null> {
  const [{ project: slug }, resolvedParams] = await Promise.all([
    params,
    searchParams,
  ]);

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
  if (!accountId) return null;

  const data = await cachedFetchShowcaseData(accountId, false);
  const projectProperties = findProjectProperties(
    data.properties,
    decodeURIComponent(slug)
  );
  if (projectProperties.length === 0) return null;

  return {
    accountId,
    data,
    projectName: projectProperties[0].project as string,
    projectProperties,
  };
}

function describeProject(resolved: ResolvedProject): string {
  const { projectName, projectProperties } = resolved;
  const count = projectProperties.length;
  const city = projectProperties.find((p) => p.city)?.city;
  const types = Array.from(new Set(projectProperties.map((p) => p.type))).slice(
    0,
    3
  );
  return `${count} available ${count === 1 ? 'listing' : 'listings'} in ${projectName}${
    city ? `, ${city}` : ''
  } — ${types.join(', ')}. Verified prices and photos, inquire directly on WhatsApp.`;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const resolved = await resolveProject(params, searchParams);
  if (!resolved) return { title: `Projects | ${BRANDING.name}` };

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl
  ).replace(/\/$/, '');
  const siteName = resolved.data.settings?.website_name || BRANDING.name;
  const title = `${resolved.projectName} — Available Properties & Prices | ${siteName}`;
  const description = describeProject(resolved);
  const { project: slug } = await params;

  return {
    title,
    description,
    alternates: { canonical: `${siteUrl}/projects/${slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${siteUrl}/projects/${slug}`,
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ProjectPage({ params, searchParams }: PageProps) {
  const resolved = await resolveProject(params, searchParams);
  if (!resolved) notFound();

  const { accountId, data, projectName, projectProperties } = resolved;
  const city = projectProperties.find((p) => p.city)?.city;
  const types = Array.from(new Set(projectProperties.map((p) => p.type)));

  const publicProperties = toPublicProperties(
    projectProperties,
    data.agents,
    data.profiles,
    false
  );

  return (
    <ShowcaseView
      properties={publicProperties}
      settings={data.settings}
      accountId={accountId}
      hero={{
        title: 'Properties in',
        highlight: projectName,
        subtitle: describeProject(resolved),
        badges: [...(city ? [city] : []), ...types.slice(0, 3)],
      }}
      disableSavedState
    />
  );
}
