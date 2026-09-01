'use client';

import { useState } from 'react';
import {
  BookOpen,
  Building2,
  CalendarDays,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CONVOREAL_QUICK_START_GUIDE_URL } from '@/lib/beta/invites';
import { readStored, writeStored } from '@/lib/safe-storage';

interface TeamMemberWelcomeProps {
  accountId: string;
  userId: string;
  role: string;
}

export function TeamMemberWelcome({
  accountId,
  userId,
  role,
}: TeamMemberWelcomeProps) {
  const storageKey = `team_member_welcome_seen_${accountId}_${userId}`;
  const [open, setOpen] = useState(() => readStored(storageKey) !== 'true');

  function dismiss() {
    writeStored(storageKey, 'true');
    setOpen(false);
  }

  if (!open) return null;

  const items = [
    {
      icon: Users,
      title: 'Contacts and requirements',
      body: 'Keep each buyer requirement current so Radar can find relevant matches.',
    },
    {
      icon: Building2,
      title: 'Inventory and sharing',
      body: 'Review listing details, share selected properties, and protect sensitive owner information.',
    },
    {
      icon: CalendarDays,
      title: 'Visits and follow-up',
      body: 'Schedule the confirmed property, notify participants, and record the outcome.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/60 bg-[#0d1424] p-7 shadow-2xl">
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          aria-label="Close welcome"
        >
          <X className="size-4" />
        </button>

        <div className="text-center">
          <div className="bg-primary/15 mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
            <Sparkles className="text-primary size-7" />
          </div>
          <p className="text-primary font-mono text-[10px] tracking-[0.16em] uppercase">
            Your role: {role}
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            Welcome to your team workspace
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The account owner has handled the technical setup. Start with the
            work that keeps contacts, properties and follow-ups moving.
          </p>
        </div>

        <div className="mt-6 space-y-2.5">
          {items.map((item) => (
            <div
              key={item.title}
              className="flex gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/60">
                <item.icon className="text-primary size-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1 gap-2 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() =>
              window.open(CONVOREAL_QUICK_START_GUIDE_URL, '_blank')
            }
          >
            <BookOpen className="size-4" /> Read the quick-start PDF
          </Button>
          <Button className="flex-1" onClick={dismiss}>
            Go to workspace
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Need a walkthrough later? Ask Copilot from any screen.
        </p>
      </div>
    </div>
  );
}
