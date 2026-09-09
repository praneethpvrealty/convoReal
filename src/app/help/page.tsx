import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, FileText, PlayCircle } from "lucide-react";
import { BRANDING } from "@/config/branding";
import { HELP_GUIDES } from "./guides";

export const metadata: Metadata = {
  title: "Help Centre",
  description:
    "Short, feature-focused ConvoReal guides for property consultants and agency teams.",
  alternates: { canonical: `${BRANDING.websiteUrl}/help` },
  robots: { index: true, follow: true },
};

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-12 flex flex-col gap-8 border-b border-slate-800 pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-indigo-300 hover:text-indigo-200"
            >
              <BookOpen className="size-4" />
              {BRANDING.name} Help Centre
            </Link>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Learn one feature at a time
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
              Open the guide for the task you are doing. Short mobile and web
              walkthrough videos will appear alongside these guides as they are
              published.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
          >
            Open ConvoReal <ArrowRight className="size-4" />
          </Link>
        </header>

        <section
          className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Feature guides"
        >
          {HELP_GUIDES.map((guide, index) => (
            <article
              key={guide.slug}
              className="group flex min-h-64 flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl shadow-slate-950/20 transition hover:-translate-y-1 hover:border-indigo-500/50"
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-xs font-black text-indigo-300">
                  GUIDE {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {guide.readTime} read
                </span>
              </div>
              <h2 className="text-xl font-black text-white">{guide.title}</h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">
                {guide.summary}
              </p>
              <div className="mt-6 flex items-center gap-4 border-t border-slate-800 pt-5 text-xs font-bold">
                <Link
                  href={`/help/${guide.slug}`}
                  className="inline-flex items-center gap-1.5 text-indigo-300 hover:text-indigo-200"
                >
                  View guide <ArrowRight className="size-3.5" />
                </Link>
                <a
                  href={guide.pdfPath}
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white"
                >
                  <FileText className="size-3.5" /> PDF
                </a>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 sm:flex sm:items-center sm:justify-between">
          <div className="flex gap-4">
            <PlayCircle className="mt-0.5 size-6 shrink-0 text-emerald-400" />
            <div>
              <h2 className="font-black text-white">
                Quick walkthrough videos
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Mobile and web videos will be embedded here from the official
                ConvoReal YouTube channel.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
