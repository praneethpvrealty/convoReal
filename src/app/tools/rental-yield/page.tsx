import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicPageShell } from '@/components/landing/public-page-shell';
import { RentalYieldCalculator } from '@/components/landing/rental-yield-calculator';
import { BRANDING } from '@/config/branding';
import {
  EMI_TOOL_PATH,
  RENTAL_YIELD_FAQ,
  RENTAL_YIELD_TOOL_PATH,
  STAMP_DUTY_TOOL_PATH,
  TOOLS_PATH,
} from '@/lib/marketing/public-tools';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScript,
  webApplicationJsonLd,
} from '@/lib/seo/jsonld';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';

const TITLE = 'Rental yield calculator';
const DESCRIPTION =
  'Calculate the gross and net rental yield of a property from its price and monthly rent, after vacancy, maintenance and purchase costs, with the payback period and the rent a target yield needs. Free, no sign-in.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'rental yield calculator',
    'rental yield India',
    'rental yield Bangalore',
    'gross vs net rental yield',
    'rental income return on property',
    'ROI on rental property',
  ],
  alternates: { canonical: `${fallbackSiteUrl()}${RENTAL_YIELD_TOOL_PATH}` },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${TITLE} | ${BRANDING.name}`,
    description: DESCRIPTION,
    type: 'website',
    url: `${fallbackSiteUrl()}${RENTAL_YIELD_TOOL_PATH}`,
  },
};

export default function RentalYieldToolPage() {
  const origin = fallbackSiteUrl();
  const url = `${origin}${RENTAL_YIELD_TOOL_PATH}`;

  return (
    <PublicPageShell>
      {[
        webApplicationJsonLd({
          name: TITLE,
          description: DESCRIPTION,
          url,
          publisherName: BRANDING.name,
          areaServed: 'India',
        }),
        faqJsonLd(RENTAL_YIELD_FAQ),
        breadcrumbJsonLd([
          { name: BRANDING.name, url: origin },
          { name: 'Free tools', url: `${origin}${TOOLS_PATH}` },
          { name: TITLE, url },
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
          Free tool
        </span>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          What does this property really return as a rental?
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-400">
          Rental yield is the rent a property earns in a year as a share of what
          it cost. Enter the price and the rent, add the yearly costs and the
          months it sits empty, and the calculator gives the gross and net
          yield, the net income and how long rent alone takes to pay the
          purchase back.
        </p>

        <div className="mt-10">
          <RentalYieldCalculator />
        </div>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">
            Rental yield, explained
          </h2>
          <div className="mt-6 space-y-4">
            {RENTAL_YIELD_FAQ.map((entry) => (
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

        <section className="mt-16 grid gap-4 sm:grid-cols-2">
          <Link
            href={STAMP_DUTY_TOOL_PATH}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-indigo-500/40"
          >
            <p className="text-sm font-bold text-white">
              Count the purchase costs properly
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Stamp duty, surcharge, cess and registration fee on this property,
              to add to the investment.
            </p>
          </Link>
          <Link
            href={EMI_TOOL_PATH}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-indigo-500/40"
          >
            <p className="text-sm font-bold text-white">Buying it on a loan?</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Compare the monthly EMI with the rent to see whether the property
              carries itself.
            </p>
          </Link>
        </section>
      </div>
    </PublicPageShell>
  );
}
