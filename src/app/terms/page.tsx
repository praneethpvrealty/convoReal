import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, ArrowLeft } from 'lucide-react';
import { BRANDING } from '@/config/branding';

export const metadata: Metadata = {
  title: `Terms of Service — ${BRANDING.name}`,
  description: `Terms and conditions for utilizing the ${BRANDING.name} real estate platform and services.`,
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col justify-between bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between border-b border-slate-800 pb-6">
          <div className="flex items-center gap-3">
            <FileText className="text-primary size-8" />
            <h1 className="text-2xl font-black tracking-tight text-white">
              {BRANDING.name}
            </h1>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-400 transition-all hover:text-white"
          >
            <ArrowLeft className="size-3.5" />
            Back to Showcase
          </Link>
        </div>

        {/* Card Block */}
        <div className="space-y-6 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 shadow-xl backdrop-blur-xl sm:p-8">
          <div className="space-y-2 border-b border-slate-800/50 pb-4">
            <h2 className="text-xl font-bold text-white">Terms of Service</h2>
            <p className="text-xs text-slate-400">
              Last updated: June 21, 2026
            </p>
          </div>

          <div className="space-y-6 text-sm leading-relaxed text-slate-300">
            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">
                1. Agreement to Terms
              </h3>
              <p>
                By accessing or using our showcase site at {BRANDING.websiteUrl}
                , you agree to be bound by these Terms of Service. If you do not
                agree to all of these terms, do not access or use the website.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">
                2. Use License & Intellectual Property
              </h3>
              <p>
                Unless otherwise stated, {BRANDING.name} and/or its licensors
                own the intellectual property rights for all material on the
                site. You may view and print pages for your own personal use,
                subject to restrictions set in these terms.
              </p>
              <p className="text-slate-400">
                You must not republish, sell, sub-license, or redistribute
                listing materials or media from {BRANDING.name} without prior
                written consent.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">
                3. User Responsibilities & Communications
              </h3>
              <p>
                When submitting property inquiries, request forms, or contacting
                real estate agents via our integrated WhatsApp message triggers,
                you agree to provide true, accurate, and current information.
              </p>
              <p>
                You acknowledge that messaging services, replies, and
                notifications are processed over third-party channels (including
                Meta&apos;s WhatsApp Business Platform) and are subject to
                standard network availability and carrier charges.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">
                4. Disclaimer & Limitations
              </h3>
              <p>
                All property listings, pricing, areas, and dimensions displayed
                on {BRANDING.websiteUrl} are provided for reference purposes
                only and do not constitute an explicit binding contract.
              </p>
              <p>
                In no event shall {BRANDING.name} or its suppliers be liable for
                any damages (including, without limitation, damages for loss of
                data or profit, or due to business interruption) arising out of
                the use or inability to use the materials on the platform.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">
                5. Governing Law
              </h3>
              <p>
                These terms and conditions are governed by and construed in
                accordance with the local laws, and you irrevocably submit to
                the exclusive jurisdiction of the courts in that location.
              </p>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-slate-500">
          &copy; {new Date().getFullYear()} {BRANDING.name}. All rights
          reserved.
        </div>
      </div>
    </div>
  );
}
