"use client"

import { useEffect, useState } from 'react'
import { Share2, Users } from 'lucide-react'
import type { PropertyReachStats } from '@/lib/agents/inventory-digest'

interface NetworkReachAccount {
  accountName: string
  properties: PropertyReachStats[]
}

/**
 * "My Inventory Network" — shown to agents whose phone matches a
 * source-agent contact in partner brokerages (GET /api/agents/
 * network-reach): how many direct and indirect buyers each of their
 * referred listings reached, per partner. Renders nothing for everyone
 * else, so the dashboard stays unchanged unless the data exists.
 */
export function NetworkReach() {
  const [accounts, setAccounts] = useState<NetworkReachAccount[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/agents/network-reach')
      .then((res) => (res.ok ? res.json() : { data: { accounts: [] } }))
      .then((json) => {
        if (!cancelled) setAccounts(json.data?.accounts ?? [])
      })
      .catch((err) => {
        console.error('[dashboard] network reach failed:', err)
        if (!cancelled) setAccounts([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!accounts || accounts.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900/45 backdrop-blur-sm shadow-md hover:border-primary/20 transition-all duration-300 relative overflow-hidden">
      <header className="flex items-center gap-2 border-b border-slate-900/60 px-5 py-4">
        <Share2 className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-white">My Inventory Network</h2>
        <span className="text-xs text-slate-500 ml-auto">
          buyers reached via partner brokerages
        </span>
      </header>
      <div className="divide-y divide-slate-900/60">
        {accounts.map((account) => (
          <div key={account.accountName} className="px-5 py-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {account.accountName}
            </p>
            {account.properties.map((p) => (
              <div
                key={p.property_id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm text-slate-200 truncate max-w-[50%]">{p.title}</span>
                <span className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5 text-blue-400" />
                    {p.directBuyers} direct
                    {p.newDirectBuyers > 0 && (
                      <span className="text-emerald-400">+{p.newDirectBuyers} new</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5 text-amber-400" />
                    {p.indirectBuyers} via partners
                    {p.newIndirectBuyers > 0 && (
                      <span className="text-emerald-400">+{p.newIndirectBuyers} new</span>
                    )}
                  </span>
                  <span>{p.agentsReached} partner agents</span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
