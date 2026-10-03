'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { AgentLoadEntry } from '@/lib/dashboard/types';

function initialsOf(name: string | null): string {
  const parts = (name || 'Agent').trim().split(/\s+/);
  return parts
    .map((p) => p[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

export function TeamWorkload({
  unassignedCount,
  agentLoad,
  loading,
}: {
  unassignedCount: number;
  agentLoad: AgentLoadEntry[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-2xl border border-slate-800/80 bg-slate-900/45 shadow-md backdrop-blur-sm">
        <div className="border-primary h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </section>
    );
  }

  const maxLoad = Math.max(1, ...agentLoad.map((a) => a.openConversations));

  return (
    <section className="hover:border-primary/20 group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/45 shadow-md backdrop-blur-sm transition-all duration-300">
      <header className="flex items-center justify-between border-b border-slate-900/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Team Workload</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Open conversations by agent
          </p>
        </div>
        <div className="bg-primary/10 text-primary border-primary/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border">
          <Users className="h-4 w-4" />
        </div>
      </header>

      <div className="border-b border-slate-900/60 px-5 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">
            Unassigned queue
          </span>
          <Link
            href="/inbox"
            aria-label={`Open inbox: ${unassignedCount} unassigned conversations`}
            className={`text-sm font-black tabular-nums underline-offset-2 hover:underline ${
              unassignedCount > 0 ? 'text-amber-400' : 'text-slate-500'
            }`}
          >
            {unassignedCount}
          </Link>
        </div>
      </div>

      <div className="max-h-[280px] flex-1 space-y-3 overflow-y-auto p-5">
        {agentLoad.length === 0 ? (
          <p className="text-xs text-slate-500">
            No open conversations assigned yet.
          </p>
        ) : (
          agentLoad.map((a) => (
            <div key={a.userId} className="flex items-center gap-3">
              <Avatar className="size-8 shrink-0 border border-slate-800">
                <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-black">
                  {initialsOf(a.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-white">
                    {a.fullName || 'Agent'}
                  </span>
                  <span className="text-xs font-black text-slate-300 tabular-nums">
                    {a.openConversations}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-950/60">
                  <div
                    className="bg-primary/70 h-full rounded-full"
                    style={{
                      width: `${(a.openConversations / maxLoad) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
