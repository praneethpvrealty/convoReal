'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Megaphone,
  Pause,
  Play,
  Archive,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { SignalWaveLoader } from '@/components/ui/signal-wave-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import { formatInrPlain } from '@/lib/format/currency';

interface CampaignRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyCode: string | null;
  propertyImage: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'ERROR';
  dailyBudgetInr: number;
  currency: string;
  headline: string | null;
  createdAt: string;
  insights: {
    spend: number;
    impressions: number;
    reach: number;
    conversationsStarted: number;
    fetchedAt: string | null;
    stale: boolean;
  } | null;
  leadsInEngine: number;
  costPerLeadInr: number | null;
}

function statusVariant(
  status: CampaignRow['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'PAUSED') return 'secondary';
  if (status === 'ERROR') return 'destructive';
  return 'outline';
}

// Kill switch — mirrors the check in the sidebar/settings/inventory
// pages (see docs/meta-ads-integration-plan.md §2). Guards direct URL
// visits even though the nav entry is already hidden without it.
const META_ADS_ENABLED = !!process.env.NEXT_PUBLIC_META_ADS_APP_ID;

export default function AdsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');

  useEffect(() => {
    if (!META_ADS_ENABLED) router.replace('/inventory');
  }, [router]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/meta-ads/campaigns');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load campaigns.');
        return;
      }
      setCampaigns(data.campaigns);
      setConnectionStatus(data.connectionStatus);
    } catch {
      toast.error('Could not load campaigns.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    campaign: CampaignRow,
    action: 'pause' | 'resume' | 'archive',
    confirmMsg?: string
  ) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(campaign.id);
    try {
      const res = await fetch(`/api/meta-ads/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update the campaign.');
        return;
      }
      toast.success(
        action === 'pause'
          ? 'Campaign paused.'
          : action === 'resume'
            ? 'Campaign resumed.'
            : 'Campaign archived.'
      );
      await load();
    } catch {
      toast.error('Could not update the campaign.');
    } finally {
      setBusyId(null);
    }
  }

  async function saveBudget(campaign: CampaignRow) {
    const value = Number(budgetDraft);
    if (!value || value < 1) {
      setEditingBudgetId(null);
      return;
    }
    setBusyId(campaign.id);
    try {
      const res = await fetch(`/api/meta-ads/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_budget', daily_budget_inr: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update the budget.');
        return;
      }
      toast.success('Budget updated.');
      setEditingBudgetId(null);
      await load();
    } catch {
      toast.error('Could not update the budget.');
    } finally {
      setBusyId(null);
    }
  }

  const metaExpired = connectionStatus === 'token_expired';
  const metaCell = metaExpired ? 'text-muted-foreground p-3' : 'p-3';
  const staleMark = (
    <span className="ml-1 text-[10px] font-normal text-amber-400">
      (last sync)
    </span>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Megaphone className="text-primary h-5 w-5" />
            Ads
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Click-to-WhatsApp campaigns running on Instagram &amp; Facebook, and
            the leads they&apos;ve produced.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {metaExpired && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center"
        >
          <AlertTriangle className="hidden size-5 shrink-0 text-amber-400 sm:block" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-200">
              Your Meta connection expired
            </p>
            <p className="text-xs text-amber-200/80">
              Spend, reach and chats below are from the last sync and may be out
              of date until you reconnect.
            </p>
          </div>
          <a
            href="/settings?tab=ads"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-amber-500 px-3 text-sm font-semibold text-slate-950 hover:bg-amber-400"
          >
            Reconnect Meta
          </a>
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center py-16">
          <SignalWaveLoader
            size={104}
            label="Loading ad campaigns"
            className="mb-3"
          />
          <ConvoRealLoader size={20} className="mb-2" />
          <p className="text-sm">Loading ad campaigns...</p>
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="space-y-3 rounded-lg border py-16 text-center">
          <Megaphone className="text-muted-foreground mx-auto h-10 w-10" />
          <h3 className="font-semibold">No campaigns yet</h3>
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">
            Promote a property from your Inventory to run its first Instagram
            &amp; Facebook ad — buyers who tap it message you directly on
            WhatsApp.
          </p>
          <a
            href="/inventory"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            Go to Inventory
          </a>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
                <th className="p-3 font-medium">Property</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Daily budget</th>
                <th className="p-3 font-medium">
                  Spend{metaExpired && staleMark}
                </th>
                <th className="p-3 font-medium">
                  Reach{metaExpired && staleMark}
                </th>
                <th className="p-3 font-medium">
                  Chats started (Meta){metaExpired && staleMark}
                </th>
                <th className="p-3 font-medium">Leads in Engine</th>
                <th className="p-3 font-medium">
                  Cost/lead{metaExpired && staleMark}
                </th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      {c.propertyImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={showcaseImageUrl(
                            c.propertyImage,
                            SHOWCASE_IMAGE_WIDTHS.thumb
                          )}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="bg-muted h-9 w-9 shrink-0 rounded" />
                      )}
                      <div className="min-w-0">
                        <a
                          href={`/inventory?propertyId=${c.propertyId}`}
                          className="block max-w-[180px] truncate font-medium hover:underline"
                        >
                          {c.propertyTitle}
                        </a>
                        {c.propertyCode && (
                          <p className="text-muted-foreground text-xs">
                            {c.propertyCode}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                  </td>
                  <td className="p-3">
                    {editingBudgetId === c.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={budgetDraft}
                          onChange={(e) => setBudgetDraft(e.target.value)}
                          type="number"
                          className="h-7 w-20 text-xs"
                          autoFocus
                          onBlur={() => saveBudget(c)}
                          onKeyDown={(e) => e.key === 'Enter' && saveBudget(c)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBudgetId(c.id);
                          setBudgetDraft(String(c.dailyBudgetInr));
                        }}
                        disabled={
                          c.status === 'ARCHIVED' || c.status === 'ERROR'
                        }
                        className="hover:underline disabled:cursor-not-allowed disabled:no-underline"
                      >
                        {formatInrPlain(c.dailyBudgetInr)}/day
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    {c.insights ? (
                      <span
                        className={
                          c.insights.stale || metaExpired
                            ? 'text-muted-foreground'
                            : ''
                        }
                      >
                        {formatInrPlain(Math.round(c.insights.spend))}
                        {(c.insights.stale || metaExpired) && (
                          <span className="ml-1 text-[10px]">(stale)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className={metaCell}>
                    {c.insights?.reach.toLocaleString('en-IN') ?? '—'}
                  </td>
                  <td className={metaCell}>
                    {c.insights?.conversationsStarted ?? '—'}
                  </td>
                  <td className="p-3 font-medium">{c.leadsInEngine}</td>
                  <td className={metaCell}>
                    {c.costPerLeadInr !== null
                      ? formatInrPlain(c.costPerLeadInr, 2)
                      : '—'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => runAction(c, 'pause')}
                          disabled={busyId === c.id}
                        >
                          <Pause className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {c.status === 'PAUSED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => runAction(c, 'resume')}
                          disabled={busyId === c.id}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            runAction(
                              c,
                              'archive',
                              "Stop and archive this ad? This can't be undone."
                            )
                          }
                          disabled={busyId === c.id}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <a
                        href={`/inventory?propertyId=${c.propertyId}`}
                        className="text-muted-foreground hover:text-foreground p-1.5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
