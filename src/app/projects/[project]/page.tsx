import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ShowcaseView } from '@/components/showcase/showcase-view';
import {
  cachedFetchFallbackAccount,
  cachedFetchProjectBySlug,
  cachedFetchShowcaseData,
  cachedResolveAccountFromSubdomain,
  resolveSubdomainFromHost,
  toPublicProperties,
  type PublicProjectInfo,
  type ShowcaseData,
} from '@/lib/showcase/public-data';
import {
  findProjectProperties,
  slugifyProject,
} from '@/lib/inventory/project-slug';
import {
  projectBhkRange,
  projectPriceHeadline,
  projectRateHeadline,
  unitStatsFromProperties,
} from '@/lib/inventory/project-pricing';
import { propertySlug } from '@/lib/showcase/property-slug';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';
import { itemListJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
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
  projectInfo: PublicProjectInfo | null;
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

  const projectInfo = await cachedFetchProjectBySlug(
    accountId,
    slugifyProject(decodeURIComponent(slug))
  );

  return {
    accountId,
    data,
    projectName: projectProperties[0].project as string,
    projectProperties,
    projectInfo,
  };
}

/**
 * What the units add up to, from the rows already fetched.
 *
 * The stats RPC guards on account membership, so it cannot serve an
 * anonymous visitor — but this page has exactly the units it needs in
 * memory. Same arithmetic as the dashboard, one implementation.
 *
 * The showcase fetches only published, Available listings, so nothing
 * here can quote a sold unit's price or count it: a catalog of what is
 * for sale should not advertise what is not.
 */
function projectStats(resolved: ResolvedProject) {
  return unitStatsFromProperties(
    resolved.projectName,
    resolved.projectProperties
  );
}

function describeProject(resolved: ResolvedProject): string {
  const { projectName, projectProperties } = resolved;
  const count = projectProperties.length;
  const city = projectProperties.find((p) => p.city)?.city;
  const types = Array.from(new Set(projectProperties.map((p) => p.type))).slice(
    0,
    3
  );
  const stats = projectStats(resolved);
  // Leads with what a buyer scanning a tower actually wants: the entry
  // price and the configurations, not a listing count.
  const price = projectPriceHeadline(stats);
  const rate = projectRateHeadline(stats);
  const bhk = projectBhkRange(stats);
  const opening = [price, rate, bhk].filter(Boolean).join(' · ');

  return `${opening ? `${opening}. ` : ''}${count} available ${
    count === 1 ? 'listing' : 'listings'
  } in ${projectName}${city ? `, ${city}` : ''} — ${types.join(
    ', '
  )}. Verified prices and photos, inquire directly on WhatsApp.`;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const resolved = await resolveProject(params, searchParams);
  if (!resolved) return { title: `Projects | ${BRANDING.name}` };

  const origin = await resolveRequestOrigin();
  const siteName = resolved.data.accountName || BRANDING.name;
  const title = `${resolved.projectName} — Available Properties & Prices | ${siteName}`;
  const description = describeProject(resolved);
  const { project: slug } = await params;

  return {
    title,
    description,
    alternates: { canonical: `${origin}/projects/${slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${origin}/projects/${slug}`,
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ProjectPage({ params, searchParams }: PageProps) {
  const resolved = await resolveProject(params, searchParams);
  if (!resolved) notFound();

  const { accountId, data, projectName, projectProperties, projectInfo } =
    resolved;
  const city = projectProperties.find((p) => p.city)?.city;
  const types = Array.from(new Set(projectProperties.map((p) => p.type)));

  const publicProperties = toPublicProperties(
    projectProperties,
    data.agents,
    data.profiles,
    false
  );

  const origin = await resolveRequestOrigin();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            itemListJsonLd(
              `Properties in ${projectName}`,
              projectProperties.map((p) => ({
                name: p.title,
                url: `${origin}/property/${propertySlug(p)}`,
              }))
            )
          ),
        }}
      />
      <ShowcaseView
        properties={publicProperties}
        settings={data.settings}
        accountId={accountId}
        siteName={data.accountName}
        engineWhatsAppPhone={data.engineWhatsAppPhone}
        projectInfo={projectInfo}
        hero={{
          title: 'Properties in',
          highlight: projectName,
          subtitle: describeProject(resolved),
          badges: [
            // Rate first: in a tower every unit shares the address, so
            // "from ₹8,200/sqft" separates it from the one next door in
            // a way the locality never can.
            ...(projectRateHeadline(projectStats(resolved))
              ? [projectRateHeadline(projectStats(resolved))]
              : []),
            ...(city ? [city] : []),
            ...types.slice(0, 3),
          ],
        }}
        disableSavedState
      />
    </>
  );
}
