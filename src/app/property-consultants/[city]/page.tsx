import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRANDING } from '@/config/branding';
import { AUTHORITY_SERVICES, publishedLocalities } from '@/lib/seo/authority';
import { loadAuthorityContext } from '@/lib/seo/authority-context';
import { buildPublicBusinessProfile } from '@/lib/seo/business-profile';
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  jsonLdScript,
  realEstateAgentJsonLd,
} from '@/lib/seo/jsonld';
import { isTeaserGated } from '@/lib/inventory/showcase-visibility';
import { propertySlug } from '@/lib/showcase/property-slug';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';

interface PageProps {
  params: Promise<{ city: string }>;
  searchParams: Promise<{ account_id?: string; ref?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const context = await loadAuthorityContext(searchParams);
  const locality = context
    ? publishedLocalities(context.properties).get((await params).city)
    : null;
  if (!context || !locality) return {};
  const businessName = context.accountName || BRANDING.name;
  const origin = await resolveRequestOrigin();
  const title = `Property consultant in ${locality.name} | ${businessName}`;
  const description = `${businessName} publishes current property opportunities in ${locality.name}. Compare available listings and discuss sourcing, land, or commercial property requirements.`;
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: `${origin}/property-consultants/${(await params).city}`,
    },
    robots: { index: true, follow: true },
    openGraph: { title, description },
  };
}

export default async function ConsultantCityPage({
  params,
  searchParams,
}: PageProps) {
  const citySlug = (await params).city;
  const context = await loadAuthorityContext(searchParams);
  if (!context) notFound();
  const locality = publishedLocalities(context.properties).get(citySlug);
  if (!locality) notFound();

  const origin = await resolveRequestOrigin();
  const businessName = context.accountName || BRANDING.name;
  const profile = buildPublicBusinessProfile(businessName, context.properties, {
    description: context.settings?.public_business_description,
    areasServed: context.settings?.public_areas_served,
    propertyTypes: context.settings?.public_property_expertise,
  });
  const publicProperties = locality.properties.filter(
    (property) => !isTeaserGated(property)
  );
  const typeCounts = Array.from(
    new Set(
      locality.properties.map((property) => property.type).filter(Boolean)
    )
  );
  const url = `${origin}/property-consultants/${citySlug}`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      {[
        realEstateAgentJsonLd({
          name: businessName,
          url: origin,
          telephone: context.settings?.contact_phone,
          profile,
        }),
        breadcrumbJsonLd([
          { name: businessName, url: origin },
          { name: `Property consultant in ${locality.name}`, url },
        ]),
        itemListJsonLd(
          `Current properties in ${locality.name}`,
          publicProperties.map((property) => ({
            name: property.title,
            url: `${origin}/property/${propertySlug(property)}`,
          }))
        ),
      ].map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
        />
      ))}
      <div className="mx-auto max-w-5xl px-6 py-12 md:py-20">
        <Link className="text-sm text-blue-700 hover:underline" href="/">
          ← View full property showcase
        </Link>
        <p className="mt-10 text-sm font-medium tracking-wider text-blue-700 uppercase">
          {businessName}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
          Property consultant in {locality.name}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
          Explore {locality.properties.length} currently published{' '}
          {locality.properties.length === 1 ? 'opportunity' : 'opportunities'}{' '}
          represented by {businessName} in {locality.name}. Confirm availability
          and property facts directly before making a decision.
        </p>
        {typeCounts.length > 0 && (
          <p className="mt-4 text-sm text-slate-500">
            Current inventory types: {typeCounts.join(', ')}.
          </p>
        )}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">
            Current properties in {locality.name}
          </h2>
          {publicProperties.length > 0 ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {publicProperties.map((property) => (
                <article
                  key={property.id}
                  className="rounded-2xl border bg-white p-6"
                >
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    {property.type}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">
                    <Link
                      className="hover:text-blue-700"
                      href={`/property/${propertySlug(property)}`}
                    >
                      {property.title}
                    </Link>
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {[property.sublocality, property.city]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-slate-600">
              Detailed listing pages are available after the consultancy shares
              access. Contact the team to discuss the current inventory.
            </p>
          )}
        </section>
        <section className="mt-12 rounded-2xl border bg-white p-7">
          <h2 className="text-2xl font-semibold">Property advisory services</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {AUTHORITY_SERVICES.map((service) => (
              <Link
                key={service.slug}
                className="rounded-xl border p-4 font-medium hover:border-blue-300 hover:text-blue-700"
                href={`/services/${service.slug}`}
              >
                {service.name}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
