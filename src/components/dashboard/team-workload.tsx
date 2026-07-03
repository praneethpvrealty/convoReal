'use client'

import { Users } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { AgentLoadEntry } from '@/lib/dashboard/types'

function initialsOf(name: string | null): string {
  const parts = (name || 'Agent').trim().split(/\s+/)
  return parts.map((p) => p[0]).join('').substring(0, 2).toUpperCase()
}

export function TeamWorkload({
  unassignedCount,
  agentLoad,
  loading,
}: {
  unassignedCount: number
  agentLoad: AgentLoadEntry[]
  loading: boolean
}) {
  if (loading) {
    return (
      <section className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/45 backdrop-blur-sm shadow-md h-full min-h-[220px] justify-center items-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </section>
    )
  }

  const maxLoad = Math.max(1, ...agentLoad.map((a) => a.openConversations))

  return (
    <section className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/45 backdrop-blur-sm shadow-md hover:border-primary/20 transition-all duration-300 relative group overflow-hidden h-full">
      <header className="border-b border-slate-900/60 px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Team Workload</h2>
          <p className="mt-0.5 text-xs text-slate-500">Open conversations by agent</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
          <Users className="h-4 w-4" />
        </div>
      </header>

      <div className="px-5 py-3 border-b border-slate-900/60">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Unassigned queue</span>
          <span
            className={`text-sm font-black tabular-nums ${
              unassignedCount > 0 ? 'text-amber-400' : 'text-slate-500'
            }`}
          >
            {unassignedCount}
          </span>
        </div>
      </div>

      <div className="flex-1 p-5 space-y-3 overflow-y-auto max-h-[280px]">
        {agentLoad.length === 0 ? (
          <p className="text-xs text-slate-500">No open conversations assigned yet.</p>
        ) : (
          agentLoad.map((a) => (
            <div key={a.userId} className="flex items-center gap-3">
              <Avatar className="size-8 border border-slate-800 shrink-0">
                <AvatarFallback className="bg-primary/10 text-[11px] font-black text-primary">
                  {initialsOf(a.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white truncate">
                    {a.fullName || 'Agent'}
                  </span>
                  <span className="text-xs font-black tabular-nums text-slate-300">
                    {a.openConversations}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-slate-950/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(a.openConversations / maxLoad) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
