import type { Metadata } from 'next';
import Link from 'next/link';

import { EmiCalculator } from '@/components/landing/emi-calculator';
import { PublicPageShell } from '@/components/landing/public-page-shell';
import { BRANDING } from '@/config/branding';
import {
  EMI_FAQ,
  EMI_TOOL_PATH,
  PROCESS_GUIDES_PATH,
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

const TITLE = 'Home loan EMI calculator';
const DESCRIPTION =
  'Calculate the monthly EMI, total interest and year-by-year balance of a home loan from the property price, down payment, interest rate and tenure. Free, no sign-in, with a WhatsApp-ready summary.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'home loan EMI calculator',
    'EMI calculator',
    'housing loan EMI',
    'home loan interest calculator',
    'EMI calculator India',
    'property loan EMI Bangalore',
  ],
  alternates: { canonical: `${fallbackSiteUrl()}${EMI_TOOL_PATH}` },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${TITLE} | ${BRANDING.name}`,
    description: DESCRIPTION,
    type: 'website',
    url: `${fallbackSiteUrl()}${EMI_TOOL_PATH}`,
  },
};

export default function EmiToolPage() {
  const origin = fallbackSiteUrl();
  const url = `${origin}${EMI_TOOL_PATH}`;

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
        faqJsonLd(EMI_FAQ),
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
          What will this home loan cost every month?
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-400">
          Enter the property price, the share you will pay up front, the
          interest rate and the tenure. The calculator gives the monthly EMI,
          the total interest over the loan, and how the balance falls year by
          year.
        </p>

        <div className="mt-10">
          <EmiCalculator />
        </div>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">
            Home loan EMIs, explained
          </h2>
          <div className="mt-6 space-y-4">
            {EMI_FAQ.map((entry) => (
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
              Add registration costs to the budget
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Stamp duty, surcharge, cess and registration fee on the same
              property, in one breakdown.
            </p>
          </Link>
          <Link
            href={`${PROCESS_GUIDES_PATH}/home-loan`}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-indigo-500/40"
          >
            <p className="text-sm font-bold text-white">
              How a home loan moves from application to disbursement
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Every stage, who handles it and how long it usually takes.
            </p>
          </Link>
        </section>
      </div>
    </PublicPageShell>
  );
}
