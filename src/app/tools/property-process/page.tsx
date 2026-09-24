import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Clock, Landmark } from 'lucide-react';

import { PublicPageShell } from '@/components/landing/public-page-shell';
import { BRANDING } from '@/config/branding';
import {
  PROCESS_GUIDES,
  PROCESS_GUIDES_PATH,
  TOOLS_PATH,
} from '@/lib/marketing/public-tools';
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  jsonLdScript,
} from '@/lib/seo/jsonld';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';

const TITLE = 'Property process guides: khata, registration, EC, TDS and loans';
const DESCRIPTION =
  'How khata transfer, khata name change, sale deed registration, encumbrance certificate, TDS on property purchase, NRI seller TDS, builder re-assignment and home loans actually move, stage by stage, with the authority and indicative time for each.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'khata transfer Bangalore',
    'khata name change BBMP',
    'sale deed registration Karnataka',
    'encumbrance certificate Kaveri',
    'TDS on property purchase',
    'TDS NRI seller property',
    'home loan process',
    'property liaison Bangalore',
  ],
  alternates: { canonical: `${fallbackSiteUrl()}${PROCESS_GUIDES_PATH}` },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${TITLE} | ${BRANDING.name}`,
    description: DESCRIPTION,
    type: 'website',
    url: `${fallbackSiteUrl()}${PROCESS_GUIDES_PATH}`,
  },
};

export default function ProcessGuidesPage() {
  const origin = fallbackSiteUrl();
  return (
    <PublicPageShell>
      {[
        itemListJsonLd(
          'Property process guides',
          PROCESS_GUIDES.map((guide) => ({
            name: guide.title,
            url: `${origin}${PROCESS_GUIDES_PATH}/${guide.slug}`,
          }))
        ),
        breadcrumbJsonLd([
          { name: BRANDING.name, url: origin },
          { name: 'Free tools', url: `${origin}${TOOLS_PATH}` },
          {
            name: 'Property process guides',
            url: `${origin}${PROCESS_GUIDES_PATH}`,
          },
        ]),
      ].map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
        />
      ))}

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <Link
          href={TOOLS_PATH}
          className="text-xs font-bold text-indigo-300 hover:text-indigo-200"
        >
          ← All free tools
        </Link>
        <span className="mt-6 block text-xs font-black tracking-wider text-indigo-400 uppercase">
          Free guides · Karnataka and pan-India
        </span>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          What happens after you buy a property, stage by stage
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-400">
          Every guide names the authority that acts at each stage and how long
          it usually takes, so buyers know what to expect and agents can set it
          out before the client asks. Durations are indicative, not promises.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {PROCESS_GUIDES.map((guide) => (
            <Link
              key={guide.slug}
              href={`${PROCESS_GUIDES_PATH}/${guide.slug}`}
              className="group flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl shadow-slate-950/20 transition hover:-translate-y-1 hover:border-indigo-500/50"
            >
              <h2 className="text-lg font-black text-white">{guide.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
                {guide.description}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-800 pt-4 text-xs font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5" /> ~{guide.totalDays} days
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Landmark className="size-3.5" /> {guide.stages.length} stages
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-indigo-300 group-hover:text-indigo-200">
                  Read <ArrowRight className="size-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <section className="mt-16 rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-900 to-indigo-950/40 p-8 sm:p-12">
          <h2 className="text-2xl font-black text-white sm:text-3xl">
            Run the process, not just read about it
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            {BRANDING.name} Liaisons keeps your directory of khata, SRO and loan
            liaisons with their rate cards, tracks every job and payment against
            the property and the client, and sends these process explanations to
            the client on WhatsApp in one tap.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
          >
            Start {BRANDING.name} free <ArrowRight className="size-3.5" />
          </Link>
        </section>
      </div>
    </PublicPageShell>
  );
}
