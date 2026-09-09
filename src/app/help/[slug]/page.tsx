import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileText,
  PlayCircle,
} from "lucide-react";
import { notFound } from "next/navigation";
import { BRANDING } from "@/config/branding";
import { HELP_GUIDES, findHelpGuide } from "../guides";

interface HelpGuidePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: HelpGuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = findHelpGuide(slug);
  if (!guide) return {};

  return {
    title: guide.title,
    description: guide.summary,
    alternates: { canonical: `${BRANDING.websiteUrl}/help/${guide.slug}` },
    robots: { index: true, follow: true },
  };
}

export default async function HelpGuidePage({ params }: HelpGuidePageProps) {
  const { slug } = await params;
  const guide = findHelpGuide(slug);
  if (!guide) notFound();

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/help"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-white"
        >
          <ArrowLeft className="size-4" /> All feature guides
        </Link>

        <header className="mt-8 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-indigo-950/30 p-7 shadow-2xl shadow-slate-950/40 sm:p-10">
          <span className="text-xs font-black uppercase tracking-widest text-indigo-300">
            ConvoReal self-help guide
          </span>
          <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-white sm:text-5xl">
            {guide.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            {guide.summary}
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a
              href={guide.pdfPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-500"
            >
              <FileText className="size-4" /> Open PDF guide
            </a>
            <a
              href={guide.pdfPath}
              download
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            >
              <Download className="size-4" /> Download PDF
            </a>
          </div>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h2 className="font-black text-white">PDF guide</h2>
              <span className="text-xs font-semibold text-slate-500">
                {guide.readTime} read
              </span>
            </div>
            <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center sm:p-12">
              <FileText className="mx-auto size-10 text-indigo-400" />
              <h3 className="mt-4 text-xl font-black text-white">
                Read the complete illustrated guide
              </h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
                Open the PDF in a new tab for the clearest reading experience on
                web or mobile, or download a copy to share with your team.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a
                  href={guide.pdfPath}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-500"
                >
                  Open guide <ArrowRight className="size-4" />
                </a>
                <a
                  href={guide.pdfPath}
                  download
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                >
                  <Download className="size-4" /> Download PDF
                </a>
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="font-black text-white">What you will learn</h2>
              <ul className="mt-5 space-y-4">
                {guide.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="flex gap-3 text-sm leading-relaxed text-slate-300"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                      <Check className="size-3" />
                    </span>
                    {highlight}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6">
              <PlayCircle className="size-7 text-indigo-400" />
              <h2 className="mt-4 font-black text-white">Video walkthrough</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Short mobile and web demonstrations will be added here from the
                ConvoReal YouTube channel.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
