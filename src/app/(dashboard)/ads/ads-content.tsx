'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Megaphone, Pause, Play, Archive, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { SignalWaveLoader } from '@/components/ui/signal-wave-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';

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
  leadsInCrm: number;
  costPerLeadInr: number | null;
}

function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

function statusVariant(status: CampaignRow['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
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

  async function runAction(campaign: CampaignRow, action: 'pause' | 'resume' | 'archive', confirmMsg?: string) {
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
      toast.success(action === 'pause' ? 'Campaign paused.' : action === 'resume' ? 'Campaign resumed.' : 'Campaign archived.');
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

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Ads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Click-to-WhatsApp campaigns running on Instagram &amp; Facebook, and the leads they&apos;ve produced.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {connectionStatus === 'token_expired' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>Your Meta connection expired — spend and lead numbers may be out of date.</span>
            <a href="/settings?tab=ads" className="text-sm font-medium underline whitespace-nowrap">Reconnect</a>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <SignalWaveLoader size={104} label="Loading ad campaigns" className="mb-3" />
          <ConvoRealLoader size={20} className="mb-2" />
          <p className="text-sm">Loading ad campaigns...</p>
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="rounded-lg border py-16 text-center space-y-3">
          <Megaphone className="h-10 w-10 text-muted-foreground mx-auto" />
          <h3 className="font-semibold">No campaigns yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Promote a property from your Inventory to run its first Instagram &amp; Facebook ad — buyers who tap it
            message you directly on WhatsApp.
          </p>
          <a
            href="/inventory"
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-medium h-9 px-4 hover:bg-primary/90"
          >
            Go to Inventory
          </a>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Property</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Daily budget</th>
                <th className="p-3 font-medium">Spend</th>
                <th className="p-3 font-medium">Reach</th>
                <th className="p-3 font-medium">Chats started (Meta)</th>
                <th className="p-3 font-medium">Leads in CRM</th>
                <th className="p-3 font-medium">Cost/lead</th>
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
                          src={showcaseImageUrl(c.propertyImage, SHOWCASE_IMAGE_WIDTHS.thumb)}
                          alt=""
                          className="h-9 w-9 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded bg-muted shrink-0" />
                      )}
                      <div className="min-w-0">
                        <a href={`/inventory?property=${c.propertyId}`} className="font-medium hover:underline truncate block max-w-[180px]">
                          {c.propertyTitle}
                        </a>
                        {c.propertyCode && <p className="text-xs text-muted-foreground">{c.propertyCode}</p>}
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
                        disabled={c.status === 'ARCHIVED' || c.status === 'ERROR'}
                        className="hover:underline disabled:no-underline disabled:cursor-not-allowed"
                      >
                        {formatINR(c.dailyBudgetInr)}/day
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    {c.insights ? (
                      <span className={c.insights.stale ? 'text-muted-foreground' : ''}>
                        {formatINR(Math.round(c.insights.spend))}
                        {c.insights.stale && <span className="text-[10px] ml-1">(stale)</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">{c.insights?.reach.toLocaleString('en-IN') ?? '—'}</td>
                  <td className="p-3">{c.insights?.conversationsStarted ?? '—'}</td>
                  <td className="p-3 font-medium">{c.leadsInCrm}</td>
                  <td className="p-3">{c.costPerLeadInr !== null ? formatINR(c.costPerLeadInr) : '—'}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'ACTIVE' && (
                        <Button size="sm" variant="ghost" onClick={() => runAction(c, 'pause')} disabled={busyId === c.id}>
                          <Pause className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {c.status === 'PAUSED' && (
                        <Button size="sm" variant="ghost" onClick={() => runAction(c, 'resume')} disabled={busyId === c.id}>
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => runAction(c, 'archive', 'Stop and archive this ad? This can\'t be undone.')}
                          disabled={busyId === c.id}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <a href={`/inventory?property=${c.propertyId}`} className="p-1.5 text-muted-foreground hover:text-foreground">
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
