'use client';

import Link from 'next/link';
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
}

const ACTIONS: Action[] = [
  {
    label: 'New Contact',
    href: '/contacts',
    icon: UserPlus,
    tint: 'text-primary',
  },
  {
    label: 'New Deal',
    href: '/pipelines',
    icon: Briefcase,
    tint: 'text-blue-400',
  },
  {
    label: 'New Broadcast',
    href: '/broadcasts/new',
    icon: Radio,
    tint: 'text-amber-400',
  },
  {
    label: 'New Automation',
    href: '/automations/new',
    icon: Zap,
    tint: 'text-primary',
  },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group hover:border-primary/25 hover:shadow-primary/4 relative flex items-center gap-3 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/45 px-4 py-3.5 transition-all duration-300 hover:bg-slate-900/60 hover:shadow-lg"
          >
            <div className="text-slate-350 group-hover:bg-primary/15 group-hover:text-primary group-hover:border-primary/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-900 bg-slate-950/60 transition-all duration-300 group-hover:scale-105">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-slate-300 transition-colors group-hover:text-white">
              {a.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
