'use client';

// ============================================================
// Admin → Demand — the copilot's feature-request backlog.
//
// Every capability users asked the helper for that ConvoReal can't
// do, ranked by how many accounts asked (breadth) then how often
// (depth). Nobody filed these — they're questions users were already
// asking, logged by the unmet-request path in /api/copilot. Expand a
// row to see who asked, from which page, and a sample question, then
// carry the winners into the roadmap and write `limit` chunks for
// the rest (src/lib/copilot/chunks.ts).
//
// Rows are per (audience, capability): agency staff, Portfolio owners
// and Portfolio buyers are three products, and the same phrase from
// each means three different things.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { ChevronDown, Lightbulb } from 'lucide-react';

import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { cn } from '@/lib/utils';

interface UsageRow {
  event: string;
  platform: string;
  audience: string;
  events: number;
  users: number;
  accounts: number;
}

interface DemandAccount {
  accountId: string;
  accountName: string;
  asks: number;
  sampleQuestion: string;
  pathname: string | null;
  lastAskedAt: string;
}

type DemandAudience = 'agent' | 'owner' | 'buyer';

interface DemandCapability {
  key: string;
  audience: DemandAudience;
  capability: string;
  accounts: number;
  asks: number;
  lastAskedAt: string;
  requesters: DemandAccount[];
}

const AUDIENCE_LABEL: Record<DemandAudience, string> = {
  agent: 'Agency',
  owner: 'Owner',
  buyer: 'Buyer',
};

const AUDIENCE_STYLE: Record<DemandAudience, string> = {
  agent: 'border-slate-600/40 bg-slate-700/40 text-slate-300',
  owner: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
  buyer: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
};

export default function DemandTab() {
  const [capabilities, setCapabilities] = useState<DemandCapability[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [demandRes, usageRes] = await Promise.all([
          fetch('/api/admin/copilot-demand'),
          fetch('/api/admin/copilot-usage'),
        ]);
        if (!demandRes.ok) {
          const data = (await demandRes.json()) as { error?: string };
          toast.error(data.error || 'Could not load the demand log');
          return;
        }
        const data = (await demandRes.json()) as {
          capabilities: DemandCapability[];
        };
        setCapabilities(data.capabilities);
        if (usageRes.ok) {
          const usageData = (await usageRes.json()) as { usage: UsageRow[] };
          setUsage(usageData.usage);
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  // Adoption rollup (copilot_events, last 30 days) split by platform.
  const adoption = useMemo(() => {
    const sum = (pred: (r: UsageRow) => boolean) =>
      usage.filter(pred).reduce((n, r) => n + r.events, 0);
    return {
      chatsWeb: sum((r) => r.event === 'chat' && r.platform === 'web'),
      chatsMobile: sum((r) => r.event === 'chat' && r.platform === 'mobile'),
      toursStarted: sum((r) => r.event === 'tour_start'),
      toursCompleted: sum((r) => r.event === 'tour_complete'),
      tickets: sum((r) => r.event === 'support_ticket'),
    };
  }, [usage]);

  const totals = useMemo(
    () => ({
      capabilities: capabilities.length,
      asks: capabilities.reduce((n, c) => n + c.asks, 0),
      accounts: new Set(
        capabilities.flatMap((c) => c.requesters.map((r) => r.accountId))
      ).size,
    }),
    [capabilities]
  );

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <ConvoRealLoader size={26} label="Loading demand log" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-[10px] font-black tracking-widest text-slate-500 uppercase">
          Copilot usage · last 30 days
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Chats · web" value={adoption.chatsWeb} />
          <Stat label="Chats · mobile" value={adoption.chatsMobile} />
          <Stat label="Tours started" value={adoption.toursStarted} />
          <Stat label="Tours completed" value={adoption.toursCompleted} />
          <Stat label="Support tickets" value={adoption.tickets} />
        </div>
        {usage.length === 0 && (
          <p className="mt-2 text-xs text-slate-600">
            No usage recorded yet — numbers appear once migration 243 is applied
            and users open the helper.
          </p>
        )}
      </div>

      <p className="mt-1 -mb-2 text-[10px] font-black tracking-widest text-slate-500 uppercase">
        Unmet demand
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Capabilities asked for" value={totals.capabilities} />
        <Stat label="Total asks" value={totals.asks} />
        <Stat label="Accounts asking" value={totals.accounts} />
      </div>

      {capabilities.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <Lightbulb className="size-6 text-slate-600" />
          <p className="text-sm text-slate-400">
            No unmet requests logged yet.
          </p>
          <p className="max-w-sm text-xs text-slate-600">
            Rows appear when users ask the in-app helper for something ConvoReal
            can&apos;t do. An empty log this early means the helper hasn&apos;t
            seen traffic — not that nothing is missing.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {capabilities.map((c, rank) => {
            const open = expanded === c.key;
            return (
              <div
                key={c.key}
                className="rounded-xl border border-slate-800 bg-slate-900/50"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : c.key)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="w-6 shrink-0 font-mono text-xs text-slate-600">
                    #{rank + 1}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                      AUDIENCE_STYLE[c.audience]
                    )}
                  >
                    {AUDIENCE_LABEL[c.audience]}
                  </span>
                  <span className="flex-1 truncate text-sm font-semibold text-white">
                    {c.capability}
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-500 sm:block">
                    {formatDistanceToNowStrict(new Date(c.lastAskedAt), {
                      addSuffix: true,
                    })}
                  </span>
                  <span className="border-primary/30 bg-primary/10 text-primary shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium">
                    {c.accounts} {c.accounts === 1 ? 'account' : 'accounts'}
                  </span>
                  <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
                    {c.asks} {c.asks === 1 ? 'ask' : 'asks'}
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-slate-500 transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </button>
                {open && (
                  <div className="border-t border-slate-800/80 px-4 py-3">
                    <div className="flex flex-col gap-2.5">
                      {c.requesters.map((r) => (
                        <div key={r.accountId} className="text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-200">
                              {r.accountName}
                            </span>
                            <span className="text-slate-500">
                              ×{r.asks}
                              {r.pathname ? ` · on ${r.pathname}` : ''} ·{' '}
                              {formatDistanceToNowStrict(
                                new Date(r.lastAskedAt),
                                { addSuffix: true }
                              )}
                            </span>
                          </div>
                          <p className="mt-0.5 text-slate-400">
                            &ldquo;{r.sampleQuestion}&rdquo;
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="font-mono text-2xl font-bold text-white tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}
