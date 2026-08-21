import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRANDING } from '@/config/branding';
import { getAuthorityService } from '@/lib/seo/authority';
import { loadAuthorityContext } from '@/lib/seo/authority-context';
import { buildPublicBusinessProfile } from '@/lib/seo/business-profile';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScript,
  realEstateAgentJsonLd,
  serviceJsonLd,
} from '@/lib/seo/jsonld';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';

interface PageProps {
  params: Promise<{ service: string }>;
  searchParams: Promise<{ account_id?: string; ref?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const context = await loadAuthorityContext(searchParams);
  if (!context) return {};

  const slug = (await params).service;
  const dbService = context.services.find(s => s.slug === slug);
  const authService = getAuthorityService(slug);

  if (!dbService && !authService) return {};

  const businessName = context.accountName || BRANDING.name;
  const origin = await resolveRequestOrigin();

  if (dbService) {
    const title = dbService.meta_title || `${dbService.title} | ${businessName}`;
    const description = dbService.meta_description || dbService.description || '';
    return {
      title: { absolute: title },
      description: description,
      alternates: { canonical: `${origin}/services/${dbService.slug}` },
      robots: { index: true, follow: true },
      openGraph: {
        title,
        description,
        url: `${origin}/services/${dbService.slug}`,
      },
    };
  } else if (authService) {
    const title = `${authService.name} | ${businessName}`;
    return {
      title: { absolute: title },
      description: authService.summary,
      alternates: { canonical: `${origin}/services/${authService.slug}` },
      robots: { index: true, follow: true },
      openGraph: {
        title,
        description: authService.summary,
        url: `${origin}/services/${authService.slug}`,
      },
    };
  }
  
  return {};
}

export default async function ServicePage({ params, searchParams }: PageProps) {
  const context = await loadAuthorityContext(searchParams);
  if (!context) notFound();

  const slug = (await params).service;
  const dbService = context.services.find(s => s.slug === slug);
  const authService = getAuthorityService(slug);

  if (!dbService && !authService) notFound();

  const origin = await resolveRequestOrigin();
  const businessName = context.accountName || BRANDING.name;
  const profile = buildPublicBusinessProfile(businessName, context.properties);
  const businessId = `${origin}#business`;

  if (dbService) {
    const url = `${origin}/services/${dbService.slug}`;
    const description = dbService.meta_description || dbService.description || '';
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        {[
          realEstateAgentJsonLd({
            name: businessName,
            url: origin,
            telephone: context.settings?.contact_phone,
            profile,
          }),
          serviceJsonLd({
            name: dbService.title,
            description,
            url,
            providerId: businessId,
            areasServed: profile.areasServed,
          }),
          breadcrumbJsonLd([
            { name: businessName, url: origin },
            { name: dbService.title, url },
          ]),
        ].map((data, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
          />
        ))}
        <div className="mx-auto max-w-4xl px-6 py-12 md:py-20">
          <Link className="text-sm text-blue-700 hover:underline" href="/">
            ← View current properties
          </Link>
          <p className="mt-10 text-sm font-medium tracking-wider text-blue-700 uppercase">
            {businessName}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            {dbService.title}
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            {dbService.description}
          </p>
          
          {dbService.content && (
            <section className="mt-12 rounded-2xl border bg-white p-7 prose prose-slate max-w-none">
              <div dangerouslySetInnerHTML={{ __html: dbService.content.replace(/\n/g, '<br />') }} />
            </section>
          )}

          <aside className="mt-12 rounded-2xl bg-slate-900 p-7 text-white">
            <h2 className="text-2xl font-semibold">
              Ready to learn more?
            </h2>
            <p className="mt-2 text-slate-300">
              Contact {businessName} to discuss this service in detail.
            </p>
            <Link
              className="mt-5 inline-block rounded-lg bg-white px-4 py-2 font-medium text-slate-900"
              href={`https://wa.me/${context.engineWhatsAppPhone || context.settings?.contact_phone?.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi, I'd like to know more about the ${dbService.title} service.`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contact on WhatsApp
            </Link>
          </aside>
        </div>
      </main>
    );
  }

  // Fallback to Authority Service (legacy)
  if (!authService) notFound(); // TS guard

  const url = `${origin}/services/${authService.slug}`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      {[
        realEstateAgentJsonLd({
          name: businessName,
          url: origin,
          telephone: context.settings?.contact_phone,
          profile,
        }),
        serviceJsonLd({
          name: authService.name,
          description: authService.summary,
          url,
          providerId: businessId,
          areasServed: profile.areasServed,
        }),
        faqJsonLd(authService.faq),
        breadcrumbJsonLd([
          { name: businessName, url: origin },
          { name: authService.name, url },
        ]),
      ].map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
        />
      ))}
      <div className="mx-auto max-w-4xl px-6 py-12 md:py-20">
        <Link className="text-sm text-blue-700 hover:underline" href="/">
          ← View current properties
        </Link>
        <p className="mt-10 text-sm font-medium tracking-wider text-blue-700 uppercase">
          {businessName}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
          {authService.name}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
          {authService.summary}
        </p>
        <section className="mt-12 rounded-2xl border bg-white p-7">
          <h2 className="text-2xl font-semibold">
            How the consultancy can help
          </h2>
          <ol className="mt-6 space-y-4">
            {authService.details.map((detail, index) => (
              <li key={detail} className="flex gap-4">
                <span className="font-semibold text-blue-700">{index + 1}</span>
                <span className="leading-7 text-slate-700">{detail}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">Common questions</h2>
          <div className="mt-6 space-y-4">
            {authService.faq.map((entry) => (
              <article
                key={entry.question}
                className="rounded-2xl border bg-white p-6"
              >
                <h3 className="font-semibold">{entry.question}</h3>
                <p className="mt-2 leading-7 text-slate-600">{entry.answer}</p>
              </article>
            ))}
          </div>
        </section>
        <aside className="mt-12 rounded-2xl bg-slate-900 p-7 text-white">
          <h2 className="text-2xl font-semibold">
            Start with current property information
          </h2>
          <p className="mt-2 text-slate-300">
            Browse the published inventory, then contact {businessName} to
            confirm availability and discuss your requirement.
          </p>
          <Link
            className="mt-5 inline-block rounded-lg bg-white px-4 py-2 font-medium text-slate-900"
            href="/"
          >
            Browse properties
          </Link>
        </aside>
      </div>
    </main>
  );
}
