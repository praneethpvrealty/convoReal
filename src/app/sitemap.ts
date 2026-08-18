import type { MetadataRoute } from 'next';
import { FARMLAND_DESTINATIONS } from '@/lib/data/farmland-destinations';
import { slugifyProject } from '@/lib/inventory/project-slug';
import {
  cachedFetchFallbackAccount,
  cachedFetchShowcaseData,
} from '@/lib/showcase/public-data';
import { isTeaserGated } from '@/lib/inventory/showcase-visibility';
import { propertySlug } from '@/lib/showcase/property-slug';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';
import type { Property } from '@/types';

// Listings churn daily — rendering per-request (with the hour-long
// unstable_cache on the underlying queries) keeps the sitemap current
// instead of freezing it at build time.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = fallbackSiteUrl();

  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: 'daily', priority: 1 },
    ...FARMLAND_DESTINATIONS.map((destination) => ({
      url: `${siteUrl}/farmland/${destination.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];

  let properties: Property[];
  try {
    let accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID || null;
    if (!accountId) accountId = await cachedFetchFallbackAccount();
    if (!accountId) return entries;
    ({ properties } = await cachedFetchShowcaseData(accountId, false));
  } catch {
    return entries;
  }

  const projectSlugs = new Set(
    properties
      .filter((p) => p.project)
      .map((p) => slugifyProject(p.project as string))
      .filter(Boolean)
  );
  entries.push(
    ...Array.from(projectSlugs).map((slug) => ({
      url: `${siteUrl}/projects/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
  );

  // A gated listing is noindex and has no public detail to crawl —
  // listing it here would advertise its existence and hand crawlers the
  // one URL the gate exists to keep quiet.
  entries.push(
    ...properties
      .filter((property) => !isTeaserGated(property))
      .map((property) => ({
        url: `${siteUrl}/property/${propertySlug(property)}`,
        images: [`${siteUrl}/api/properties/${property.id}/og-image`],
        lastModified: property.updated_at
          ? new Date(property.updated_at)
          : undefined,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }))
  );

  return entries;
}
