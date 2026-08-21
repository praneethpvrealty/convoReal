import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRANDING } from '@/config/branding';
import { loadAuthorityContext } from '@/lib/seo/authority-context';
import { buildPublicBusinessProfile } from '@/lib/seo/business-profile';
import {
  breadcrumbJsonLd,
  jsonLdScript,
  realEstateAgentJsonLd,
  articleJsonLd,
} from '@/lib/seo/jsonld';
import { resolveRequestOrigin } from '@/lib/showcase/site-url';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ account_id?: string; ref?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const context = await loadAuthorityContext(searchParams);
  if (!context) return {};

  const slug = (await params).slug;
  const article = context.articles.find((a) => a.slug === slug);
  if (!article) return {};

  const businessName = context.accountName || BRANDING.name;
  const origin = await resolveRequestOrigin();

  const title = article.meta_title || `${article.title} | ${businessName}`;
  const description = article.meta_description || article.excerpt || '';

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `${origin}/articles/${article.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: `${origin}/articles/${article.slug}`,
      ...(article.image_url ? { images: [{ url: article.image_url }] } : {}),
      type: 'article',
      ...(article.published_at ? { publishedTime: article.published_at } : {}),
      modifiedTime: article.updated_at,
    },
  };
}

export default async function ArticlePage({ params, searchParams }: PageProps) {
  const context = await loadAuthorityContext(searchParams);
  if (!context) notFound();

  const slug = (await params).slug;
  const article = context.articles.find((a) => a.slug === slug);
  if (!article) notFound();

  const origin = await resolveRequestOrigin();
  const businessName = context.accountName || BRANDING.name;
  const profile = buildPublicBusinessProfile(businessName, context.properties);
  const url = `${origin}/articles/${article.slug}`;

  const description = article.meta_description || article.excerpt || '';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      {[
        realEstateAgentJsonLd({
          name: businessName,
          url: origin,
          telephone: context.settings?.contact_phone,
          profile,
        }),
        articleJsonLd({
          headline: article.title,
          description,
          image: article.image_url,
          datePublished: article.published_at || article.updated_at,
          dateModified: article.updated_at,
          authorName: businessName,
          publisherName: businessName,
          url,
        }),
        breadcrumbJsonLd([
          { name: businessName, url: origin },
          { name: article.title, url },
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
          ← Back to Showcase
        </Link>
        <p className="mt-10 text-sm font-medium tracking-wider text-blue-700 uppercase">
          {businessName} • {new Date(article.published_at || article.updated_at).toLocaleDateString()}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
          {article.title}
        </h1>
        
        {article.image_url && (
          <div className="mt-10 overflow-hidden rounded-2xl bg-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={article.image_url} 
              alt={article.title}
              className="w-full h-auto max-h-[500px] object-cover"
            />
          </div>
        )}

        {article.content && (
          <article className="mt-12 rounded-2xl border bg-white p-7 prose prose-slate max-w-none">
            <div dangerouslySetInnerHTML={{ __html: article.content.replace(/\n/g, '<br />') }} />
          </article>
        )}
      </div>
    </main>
  );
}
