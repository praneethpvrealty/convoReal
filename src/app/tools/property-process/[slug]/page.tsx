import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Clock, Landmark } from 'lucide-react';

import { PublicPageShell } from '@/components/landing/public-page-shell';
import { BRANDING } from '@/config/branding';
import {
  GUIDANCE_TOOL_PATH,
  PROCESS_GUIDES,
  PROCESS_GUIDES_PATH,
  TOOLS_PATH,
  durationText,
  findProcessGuide,
} from '@/lib/marketing/public-tools';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  howToJsonLd,
  jsonLdScript,
} from '@/lib/seo/jsonld';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return PROCESS_GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const guide = findProcessGuide((await params).slug);
  if (!guide) return {};
  const url = `${fallbackSiteUrl()}${PROCESS_GUIDES_PATH}/${guide.slug}`;
  const description = `${guide.description} ${guide.stages.length} stages, ${durationText(guide)}.`;
  return {
    title: `${guide.title}: stages, authority and time`,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${guide.title} | ${BRANDING.name}`,
      description,
      type: 'article',
      url,
    },
  };
}

export default async function ProcessGuidePage({ params }: PageProps) {
  const guide = findProcessGuide((await params).slug);
  if (!guide) notFound();

  const origin = fallbackSiteUrl();
  const url = `${origin}${PROCESS_GUIDES_PATH}/${guide.slug}`;
  const others = PROCESS_GUIDES.filter((other) => other.slug !== guide.slug);

  return (
    <PublicPageShell>
      {[
        howToJsonLd({
          name: guide.title,
          description: guide.description,
          url,
          totalDays: guide.totalDays ?? 0,
          steps: guide.stages.map((stage) => ({
            name: stage.name,
            text: [
              stage.description,
              stage.authority ? `Handled by ${stage.authority}.` : null,
              stage.duration_days
                ? `About ${stage.duration_days} ${stage.duration_days === 1 ? 'day' : 'days'}.`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
          })),
        }),
        faqJsonLd(guide.faq),
        breadcrumbJsonLd([
          { name: BRANDING.name, url: origin },
          { name: 'Free tools', url: `${origin}${TOOLS_PATH}` },
          {
            name: 'Property process guides',
            url: `${origin}${PROCESS_GUIDES_PATH}`,
          },
          { name: guide.title, url },
        ]),
      ].map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
        />
      ))}

      <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:px-8">
        <Link
          href={PROCESS_GUIDES_PATH}
          className="inline-flex items-center gap-2 text-xs font-bold text-indigo-300 hover:text-indigo-200"
        >
          <ArrowLeft className="size-3.5" /> All process guides
        </Link>

        <header className="mt-8 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-indigo-950/30 p-7 sm:p-10">
          <span className="text-xs font-black tracking-widest text-indigo-300 uppercase">
            Process guide
          </span>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {guide.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            {guide.description}
          </p>
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-indigo-300" />
              <dt className="text-slate-500">Typical time</dt>
              <dd className="font-bold text-white">{durationText(guide)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Landmark className="size-4 text-indigo-300" />
              <dt className="text-slate-500">Stages</dt>
              <dd className="font-bold text-white">{guide.stages.length}</dd>
            </div>
          </dl>
        </header>

        <ol className="mt-10 space-y-4">
          {guide.stages.map((stage, index) => (
            <li
              key={stage.name}
              id={`step-${index + 1}`}
              className="flex gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-black text-indigo-300">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white">{stage.name}</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {[
                    stage.authority,
                    stage.duration_days
                      ? `about ${stage.duration_days} ${stage.duration_days === 1 ? 'day' : 'days'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {stage.description && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">
                    {stage.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-14">
          <h2 className="text-2xl font-black text-white">Common questions</h2>
          <div className="mt-6 space-y-4">
            {guide.faq.map((entry) => (
              <article
                key={entry.question}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <h3 className="text-base font-bold text-white">
                  {entry.question}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {entry.answer}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-3xl border border-indigo-500/30 bg-indigo-500/10 p-7 sm:p-10">
          <h2 className="text-2xl font-black text-white">
            Send this to your client on WhatsApp
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Brokerages on {BRANDING.name} keep a liaison directory with rate
            cards, log every job and payment against the property, and share
            this exact stage-by-stage explanation with the client in one tap.
            Registering first? Check the property&apos;s guidance value.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
            >
              Start {BRANDING.name} free <ArrowRight className="size-3.5" />
            </Link>
            <Link
              href={GUIDANCE_TOOL_PATH}
              className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950 px-6 py-3 text-xs font-semibold text-slate-200 transition hover:bg-slate-900"
            >
              Find guidance value
            </Link>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-black text-white">Other processes</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`${PROCESS_GUIDES_PATH}/${other.slug}`}
                  className="block rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-indigo-500/40 hover:text-white"
                >
                  {other.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicPageShell>
  );
}
