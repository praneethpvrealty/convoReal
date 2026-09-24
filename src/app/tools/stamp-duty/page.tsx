import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicPageShell } from '@/components/landing/public-page-shell';
import { StampDutyCalculator } from '@/components/landing/stamp-duty-calculator';
import { BRANDING } from '@/config/branding';
import {
  EMI_TOOL_PATH,
  GUIDANCE_TOOL_PATH,
  STAMP_DUTY_FAQ,
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
import { formatInrCompact } from '@/lib/tools/format';
import {
  AREA_TYPE_LABELS,
  KARNATAKA_STAMP_DUTY,
  percentText,
} from '@/lib/tools/stamp-duty';

const TITLE = 'Karnataka stamp duty and registration calculator';
const DESCRIPTION =
  'Calculate stamp duty, surcharge, cess and registration fee on a property sale deed in Karnataka. Enter the sale price and guidance value and see the total payable at registration with every rate shown.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'stamp duty calculator Karnataka',
    'stamp duty Bangalore',
    'registration charges Karnataka',
    'stamp duty and registration Bengaluru',
    'property registration cost Karnataka',
    'Kaveri stamp duty',
  ],
  alternates: { canonical: `${fallbackSiteUrl()}${STAMP_DUTY_TOOL_PATH}` },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${TITLE} | ${BRANDING.name}`,
    description: DESCRIPTION,
    type: 'website',
    url: `${fallbackSiteUrl()}${STAMP_DUTY_TOOL_PATH}`,
  },
};

export default function StampDutyToolPage() {
  const origin = fallbackSiteUrl();
  const url = `${origin}${STAMP_DUTY_TOOL_PATH}`;
  const { slabs, surcharge, cess, registration } = KARNATAKA_STAMP_DUTY;

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
        faqJsonLd(STAMP_DUTY_FAQ),
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
          What will registering this property cost?
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-400">
          Stamp duty, surcharge, cess and the registration fee are charged on
          the higher of the sale price and the guidance value. Enter both and
          pick where the property is to see the full amount payable at the
          sub-registrar office.
        </p>

        <div className="mt-10">
          <StampDutyCalculator />
        </div>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">
            Rates this calculator uses
          </h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500">
                  <th className="px-5 py-3 font-semibold">Charge</th>
                  <th className="px-5 py-3 font-semibold">Rate</th>
                  <th className="px-5 py-3 font-semibold">On</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {slabs.map((slab, index) => (
                  <tr
                    key={index}
                    className="border-b border-slate-900 last:border-0"
                  >
                    <td className="px-5 py-3">
                      Stamp duty,{' '}
                      {slab.upTo === null
                        ? `above ${formatInrCompact(slabs[index - 1].upTo ?? 0)}`
                        : index === 0
                          ? `up to ${formatInrCompact(slab.upTo)}`
                          : `${formatInrCompact((slabs[index - 1].upTo ?? 0) + 1)} to ${formatInrCompact(slab.upTo)}`}
                    </td>
                    <td className="px-5 py-3 font-semibold text-white">
                      {percentText(slab.rate)}
                    </td>
                    <td className="px-5 py-3">Chargeable value</td>
                  </tr>
                ))}
                <tr className="border-b border-slate-900">
                  <td className="px-5 py-3">
                    Surcharge, {AREA_TYPE_LABELS.urban}
                  </td>
                  <td className="px-5 py-3 font-semibold text-white">
                    {percentText(surcharge.urban)}
                  </td>
                  <td className="px-5 py-3">Stamp duty</td>
                </tr>
                <tr className="border-b border-slate-900">
                  <td className="px-5 py-3">
                    Surcharge, {AREA_TYPE_LABELS.rural}
                  </td>
                  <td className="px-5 py-3 font-semibold text-white">
                    {percentText(surcharge.rural)}
                  </td>
                  <td className="px-5 py-3">Stamp duty</td>
                </tr>
                <tr className="border-b border-slate-900">
                  <td className="px-5 py-3">Cess</td>
                  <td className="px-5 py-3 font-semibold text-white">
                    {percentText(cess)}
                  </td>
                  <td className="px-5 py-3">Stamp duty</td>
                </tr>
                <tr>
                  <td className="px-5 py-3">Registration fee</td>
                  <td className="px-5 py-3 font-semibold text-white">
                    {percentText(registration)}
                  </td>
                  <td className="px-5 py-3">Chargeable value</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-black text-white">
            Stamp duty in Karnataka, explained
          </h2>
          <div className="mt-6 space-y-4">
            {STAMP_DUTY_FAQ.map((entry) => (
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
            href={GUIDANCE_TOOL_PATH}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-indigo-500/40"
          >
            <p className="text-sm font-bold text-white">
              Find the guidance value first
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Search the Karnataka notification by area, road and survey number
              to get the value duty is charged on.
            </p>
          </Link>
          <Link
            href={EMI_TOOL_PATH}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 transition hover:border-indigo-500/40"
          >
            <p className="text-sm font-bold text-white">
              Financing the purchase?
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Work out the monthly EMI and total interest for the loan on this
              property.
            </p>
          </Link>
        </section>
      </div>
    </PublicPageShell>
  );
}
