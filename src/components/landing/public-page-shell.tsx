import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

import { ConvoRealMark } from '@/components/brand/mark';
import { BRANDING } from '@/config/branding';
import { TOOLS_PATH } from '@/lib/marketing/public-tools';

interface PublicPageShellProps {
  children: ReactNode;
}

export function PublicPageShell({ children }: PublicPageShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 font-sans text-slate-100 selection:bg-indigo-500 selection:text-white">
      <header className="sticky top-0 z-50 w-full border-b border-slate-900 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-500/25">
              <ConvoRealMark className="h-6 w-6" />
            </div>
            <span className="bg-gradient-to-r from-white via-slate-200 to-indigo-400 bg-clip-text text-xl font-bold tracking-tight text-transparent">
              {BRANDING.name}
            </span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-300 md:flex">
            <Link
              href="/#features"
              className="transition-colors hover:text-white"
            >
              Features
            </Link>
            <Link
              href={TOOLS_PATH}
              className="transition-colors hover:text-white"
            >
              Free tools
            </Link>
            <Link
              href="/#pricing"
              className="transition-colors hover:text-white"
            >
              Pricing
            </Link>
            <Link href="/help" className="transition-colors hover:text-white">
              Help
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-3 text-xs font-semibold text-slate-300 hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
            >
              Start Free Trial <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-900 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p className="font-medium">
            &copy; {new Date().getFullYear()} {BRANDING.name}. All rights
            reserved.
          </p>
          <div className="flex items-center gap-6 font-semibold">
            <Link href={TOOLS_PATH} className="hover:text-slate-300">
              Free tools
            </Link>
            <Link href="/help" className="hover:text-slate-300">
              Help
            </Link>
            <Link href="/privacy" className="hover:text-slate-300">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-slate-300">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
