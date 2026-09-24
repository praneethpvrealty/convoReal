import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Landmark, Route } from 'lucide-react';

import { PublicPageShell } from '@/components/landing/public-page-shell';
import { BRANDING } from '@/config/branding';
import {
  PROCESS_GUIDES,
  PROCESS_GUIDES_PATH,
  PUBLIC_TOOLS,
  TOOLS_PATH,
} from '@/lib/marketing/public-tools';
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  jsonLdScript,
} from '@/lib/seo/jsonld';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';

const TITLE = 'Free real estate tools for Karnataka';
const DESCRIPTION =
  'Free tools from ConvoReal: find the Karnataka guidance value of a property by area and road, and follow step-by-step guides to khata transfer, sale deed registration, encumbrance certificate, TDS and home loans.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${fallbackSiteUrl()}${TOOLS_PATH}` },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${TITLE} | ${BRANDING.name}`,
    description: DESCRIPTION,
    type: 'website',
    url: `${fallbackSiteUrl()}${TOOLS_PATH}`,
  },
};

const TOOL_ICONS = {
  'guidance-value': Landmark,
  'property-process': Route,
} as const;

export default function ToolsPage() {
  const origin = fallbackSiteUrl();
  return (
    <PublicPageShell>
      {[
        itemListJsonLd(
          TITLE,
          PUBLIC_TOOLS.map((tool) => ({
            name: tool.name,
            url: `${origin}${tool.path}`,
          }))
        ),
        breadcrumbJsonLd([
          { name: BRANDING.name, url: origin },
          { name: 'Free tools', url: `${origin}${TOOLS_PATH}` },
        ]),
      ].map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
        />
      ))}
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <span className="text-xs font-black tracking-wider text-indigo-400 uppercase">
          Free tools
        </span>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          Answers property buyers and agents look up every day
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
          The same engines that run inside {BRANDING.name}, open to everyone. No
          sign-in, no app to install.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PUBLIC_TOOLS.map((tool) => {
            const Icon = TOOL_ICONS[tool.slug as keyof typeof TOOL_ICONS];
            return (
              <Link
                key={tool.slug}
                href={tool.path}
                className="group flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-7 shadow-xl shadow-slate-950/20 transition hover:-translate-y-1 hover:border-indigo-500/50"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-5 text-xl font-black text-white">
                  {tool.name}
                </h2>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">
                  {tool.summary}
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-300 group-hover:text-indigo-200">
                  {tool.cta} <ArrowRight className="size-3.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">Process guides</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {PROCESS_GUIDES.map((guide) => (
              <li key={guide.slug}>
                <Link
                  href={`${PROCESS_GUIDES_PATH}/${guide.slug}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4 text-sm font-semibold text-slate-200 transition hover:border-indigo-500/40 hover:text-white"
                >
                  <span>{guide.title}</span>
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    ~{guide.totalDays} days
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicPageShell>
  );
}
