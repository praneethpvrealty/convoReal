import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Calculator, FileSearch, MapPinned } from 'lucide-react';

import { PublicGuidanceValueTool } from '@/components/landing/public-guidance-value-tool';
import { PublicPageShell } from '@/components/landing/public-page-shell';
import { BRANDING } from '@/config/branding';
import { cachedGuidanceCoverage } from '@/lib/guidance-value/coverage';
import {
  GUIDANCE_TOOL_PATH,
  GUIDANCE_VALUE_FAQ,
  PROCESS_GUIDES_PATH,
  TOOLS_PATH,
} from '@/lib/marketing/public-tools';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScript,
  webApplicationJsonLd,
} from '@/lib/seo/jsonld';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';

const TITLE = 'Karnataka guidance value finder';
const DESCRIPTION =
  'Find the government guidance value of a site, flat, house or land in Karnataka. Search the published notification by area, road, village or survey number and estimate the value used for stamp duty and registration.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'guidance value',
    'guidance value Bangalore',
    'guidance value Bengaluru',
    'Karnataka guidance value',
    'guideline value Karnataka',
    'Kaveri Online guidance value',
    'stamp duty Karnataka',
    'property registration value',
  ],
  alternates: { canonical: `${fallbackSiteUrl()}${GUIDANCE_TOOL_PATH}` },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${TITLE} | ${BRANDING.name}`,
    description: DESCRIPTION,
    type: 'website',
    url: `${fallbackSiteUrl()}${GUIDANCE_TOOL_PATH}`,
  },
};

const STEPS = [
  {
    icon: MapPinned,
    title: 'Name the place',
    text: 'Enter the area or layout, the road, the village and the survey number as they appear on the sale deed schedule or khata.',
  },
  {
    icon: FileSearch,
    title: 'Match the notification',
    text: 'The finder searches every imported Karnataka notification and ranks the rates by area, road, survey number and property class.',
  },
  {
    icon: Calculator,
    title: 'Get the value',
    text: 'The chosen rate is converted to a per sq.ft rate and multiplied by the land extent or built-up area to give the guidance value.',
  },
];

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

export default async function GuidanceValueToolPage() {
  const origin = fallbackSiteUrl();
  const url = `${origin}${GUIDANCE_TOOL_PATH}`;
  const coverage = await cachedGuidanceCoverage().catch(() => []);

  return (
    <PublicPageShell>
      {[
        webApplicationJsonLd({
          name: TITLE,
          description: DESCRIPTION,
          url,
          publisherName: BRANDING.name,
          areaServed: 'Karnataka, India',
        }),
        faqJsonLd(GUIDANCE_VALUE_FAQ),
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
          Free tool · Karnataka
        </span>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          Find the guidance value of any property in Karnataka
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-400">
          Guidance value is the minimum value at which a property can be
          registered, notified by the Karnataka Department of Stamps and
          Registration for every locality, road and survey number. Enter the
          location from the sale deed schedule and this finder matches it to the
          published notification and works out the value stamp duty is charged
          on.
        </p>

        <div className="mt-10">
          <PublicGuidanceValueTool />
        </div>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">How it works</h2>
          <ol className="mt-6 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                    <step.icon className="size-4" />
                  </div>
                  <span className="text-xs font-black text-slate-500">
                    STEP {index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-bold text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">Coverage</h2>
          {coverage.length > 0 ? (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {coverage.map((entry) => (
                <li
                  key={entry.district}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4"
                >
                  <p className="text-sm font-bold text-white">
                    {entry.district}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.notifications}{' '}
                    {entry.notifications === 1
                      ? 'notification'
                      : 'notifications'}
                    {entry.latest
                      ? ` · latest effective ${formatDate(entry.latest)}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Notifications are being loaded district by district. Check the
              area on Kaveri Online Services meanwhile.
            </p>
          )}
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">
            Guidance value, explained
          </h2>
          <div className="mt-6 space-y-4">
            {GUIDANCE_VALUE_FAQ.map((entry) => (
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

        <section className="mt-16 rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-900 to-indigo-950/40 p-8 sm:p-12">
          <h2 className="text-2xl font-black text-white sm:text-3xl">
            Registering soon? See the whole process.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            Sale deed registration, khata transfer, encumbrance certificate and
            TDS, stage by stage with the authority and time for each. Brokerages
            on {BRANDING.name} share these with clients on WhatsApp and track
            the liaison doing the running around.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={PROCESS_GUIDES_PATH}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
            >
              Browse process guides <ArrowRight className="size-3.5" />
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950 px-6 py-3 text-xs font-semibold text-slate-200 transition hover:bg-slate-900"
            >
              Start {BRANDING.name} free
            </Link>
          </div>
        </section>
      </div>
    </PublicPageShell>
  );
}
