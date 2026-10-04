'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Megaphone,
  Pause,
  Play,
  Archive,
  AlertTriangle,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { TabSkeleton } from '@/components/dashboard/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { InfoHint } from '@/components/ui/info-hint';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCan } from '@/hooks/use-can';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import { formatRelative } from '@/lib/format/date';
import { formatAdMoney } from '@/lib/meta-ads/format';

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

interface Connection {
  status: string;
  adAccountId: string | null;
  pageId: string | null;
  currency: string | null;
}

interface CampaignsResponse {
  campaigns: CampaignRow[];
  connection: Connection | null;
}

const STATUS_LABELS: Record<CampaignRow['status'], string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  ARCHIVED: 'Archived',
  ERROR: 'Error',
};

const WINDOW_LABEL = '(last 30 days)';

const CONNECT_STEPS = [
  'Connect Meta in Settings → Ads',
  'Choose your ad account and Facebook Page',
  'Promote a property from Inventory',
];

function statusVariant(
  status: CampaignRow['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'PAUSED') return 'secondary';
  if (status === 'ERROR') return 'destructive';
  return 'outline';
}

async function fetchCampaigns(): Promise<CampaignsResponse> {
  const res = await fetch('/api/meta-ads/campaigns');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load campaigns.');
  return data as CampaignsResponse;
}

function ColumnHead({
  label,
  hint,
  windowed = true,
}: {
  label: string;
  hint?: string;
  windowed?: boolean;
}) {
  return (
    <th className="p-3 font-medium">
      <span className="inline-flex items-center">
        {label}
        {hint && <InfoHint text={hint} />}
      </span>
      {windowed && (
        <span className="block text-[10px] font-normal">{WINDOW_LABEL}</span>
      )}
    </th>
  );
}

// Kill switch — mirrors the check in the sidebar/settings/inventory
// pages (see docs/meta-ads-integration-plan.md §2). Guards direct URL
// visits even though the nav entry is already hidden without it.
const META_ADS_ENABLED = !!process.env.NEXT_PUBLIC_META_ADS_APP_ID;

export default function AdsPage() {
  const router = useRouter();
  const canEdit = useCan('send-messages');
  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['meta-ads-campaigns'],
    queryFn: fetchCampaigns,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CampaignRow | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const budgetSettled = useRef(false);

  useEffect(() => {
    if (!META_ADS_ENABLED) router.replace('/inventory');
  }, [router]);

  const campaigns = data?.campaigns ?? [];
  const connection = data?.connection ?? null;
  const status = connection?.status ?? 'not_connected';
  const needsReconnect =
    status === 'token_expired' || status === 'disconnected';
  const connected = status === 'connected' && !!connection?.adAccountId;
  const needsSetup = status === 'connected' && !connection?.adAccountId;
  const notConnected = !connected && !needsReconnect && !needsSetup;
  const canManage = canEdit && connected;
  const manageHint = canManage ? undefined : 'Reconnect Meta to manage this ad';

  async function runAction(
    campaign: CampaignRow,
    action: 'pause' | 'resume' | 'archive'
  ) {
    setBusyId(campaign.id);
    try {
      const res = await fetch(`/api/meta-ads/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || 'Could not update the campaign.');
        return;
      }
      toast.success(
        action === 'pause'
          ? 'Campaign paused.'
          : action === 'resume'
            ? 'Campaign resumed.'
            : 'Campaign archived.'
      );
      await refetch();
    } catch {
      toast.error('Could not update the campaign.');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    const target = archiveTarget;
    setArchiveTarget(null);
    await runAction(target, 'archive');
  }

  function startBudgetEdit(campaign: CampaignRow) {
    budgetSettled.current = false;
    setBudgetError(null);
    setBudgetDraft(String(campaign.dailyBudgetInr));
    setEditingBudgetId(campaign.id);
  }

  function cancelBudgetEdit() {
    budgetSettled.current = true;
    setBudgetError(null);
    setEditingBudgetId(null);
  }

  async function saveBudget(campaign: CampaignRow) {
    if (budgetSettled.current) return;
    const value = Number(budgetDraft);
    if (!budgetDraft.trim() || !Number.isFinite(value)) {
      setBudgetError('Enter a daily budget.');
      return;
    }
    if (value === campaign.dailyBudgetInr) {
      cancelBudgetEdit();
      return;
    }
    budgetSettled.current = true;
    setBudgetError(null);
    setBusyId(campaign.id);
    try {
      const res = await fetch(`/api/meta-ads/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_budget', daily_budget_inr: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        budgetSettled.current = false;
        setBudgetError(body.error || 'Could not update the budget.');
        return;
      }
      toast.success('Budget updated.');
      setEditingBudgetId(null);
      await refetch();
    } catch {
      budgetSettled.current = false;
      setBudgetError('Could not update the budget.');
    } finally {
      setBusyId(null);
    }
  }

  const metaCell = needsReconnect ? 'text-muted-foreground p-3' : 'p-3';

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
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {isPending ? (
        <TabSkeleton label="Loading ads" cards={3} />
      ) : isError && !data ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border py-16 text-center"
        >
          <AlertTriangle className="text-destructive mx-auto h-10 w-10" />
          <h3 className="font-semibold">Couldn&apos;t load your ads</h3>
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">
            {error instanceof Error ? error.message : 'Please try again.'}
          </p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {isError && (
            <p
              role="alert"
              className="text-destructive flex items-center gap-2 text-sm"
            >
              Couldn&apos;t refresh your ads.
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                Retry
              </Button>
            </p>
          )}

          {needsReconnect && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center"
            >
              <AlertTriangle className="hidden size-5 shrink-0 text-amber-400 sm:block" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-200">
                  {status === 'disconnected'
                    ? 'Meta is disconnected'
                    : 'Your Meta connection expired'}
                </p>
                <p className="text-xs text-amber-200/80">
                  Your ads keep running and billing on Meta. To pause an ad or
                  change a budget here, reconnect Meta first. Figures below are
                  from the last sync.
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

          {needsSetup && (
            <div
              role="status"
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Finish connecting Meta</p>
                <p className="text-muted-foreground text-xs">
                  Meta is connected. Choose the ad account and Facebook Page to
                  run ads from.
                </p>
              </div>
              <a
                href="/settings?tab=ads"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium"
              >
                Choose ad account
              </a>
            </div>
          )}

          {notConnected && (
            <div className="space-y-4 rounded-lg border p-6">
              <div>
                <h3 className="font-semibold">
                  Connect Meta to start advertising
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Buyers who tap your ad message you directly on WhatsApp.
                </p>
              </div>
              <ol className="space-y-2 text-sm">
                {CONNECT_STEPS.map((step, index) => (
                  <li key={step} className="flex items-center gap-3">
                    <span className="bg-primary/10 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <a
                href="/settings?tab=ads"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium"
              >
                Connect Meta
              </a>
            </div>
          )}

          {connected && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Connected · {connection?.adAccountId}
              {connection?.currency ? ` · ${connection.currency}` : ''}
            </p>
          )}

          {campaigns.length === 0 ? (
            !notConnected && (
              <div className="space-y-3 rounded-lg border py-16 text-center">
                <Megaphone className="text-muted-foreground mx-auto h-10 w-10" />
                <h3 className="font-semibold">No campaigns yet</h3>
                <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                  Promote a property from your Inventory to run its first
                  Instagram &amp; Facebook ad — buyers who tap it message you
                  directly on WhatsApp.
                </p>
                <a
                  href="/inventory"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium"
                >
                  Go to Inventory
                </a>
              </div>
            )
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
                    <th className="p-3 font-medium">Property</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Daily budget</th>
                    <ColumnHead label="Spend" />
                    <ColumnHead label="Reach" />
                    <ColumnHead
                      label="Chats (Meta)"
                      hint="Conversations Meta counts as started from this ad, using Meta's own attribution. It can differ from the contacts that actually reach ConvoReal."
                    />
                    <ColumnHead
                      label="New contacts (ConvoReal)"
                      hint="Distinct contacts who messaged you from this ad, counted once even if they tapped it more than once. Counted by ConvoReal, so it can differ from Meta's chats."
                    />
                    <ColumnHead label="Cost per lead" />
                    <th className="p-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const live = c.status === 'ACTIVE' || c.status === 'PAUSED';
                    const archived = c.status === 'ARCHIVED';
                    const showAsOf =
                      !!c.insights?.fetchedAt &&
                      (archived || c.insights.stale || needsReconnect);
                    const noLeadsYet =
                      c.costPerLeadInr === null &&
                      !!c.insights &&
                      c.insights.spend > 0 &&
                      c.leadsInEngine === 0;
                    return (
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
                          <span className="inline-flex items-center">
                            <Badge variant={statusVariant(c.status)}>
                              {STATUS_LABELS[c.status]}
                            </Badge>
                            {c.status === 'ERROR' && (
                              <InfoHint text="Couldn't go live. Archive this ad and promote the property again." />
                            )}
                          </span>
                        </td>
                        <td className="p-3">
                          {editingBudgetId === c.id ? (
                            <div className="space-y-1">
                              <Input
                                value={budgetDraft}
                                onChange={(e) => setBudgetDraft(e.target.value)}
                                type="number"
                                aria-label="Daily budget"
                                aria-invalid={!!budgetError}
                                className="h-7 w-24 text-xs"
                                autoFocus
                                onBlur={() => saveBudget(c)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void saveBudget(c);
                                  } else if (e.key === 'Escape') {
                                    cancelBudgetEdit();
                                  }
                                }}
                              />
                              {budgetError && (
                                <p className="text-destructive max-w-[180px] text-xs">
                                  {budgetError}
                                </p>
                              )}
                            </div>
                          ) : live && canManage ? (
                            <button
                              type="button"
                              onClick={() => startBudgetEdit(c)}
                              aria-label={`Edit daily budget, ${formatAdMoney(c.dailyBudgetInr, c.currency)} per day`}
                              className="inline-flex items-center gap-1.5 hover:underline"
                            >
                              {formatAdMoney(c.dailyBudgetInr, c.currency)}/day
                              <Pencil className="text-muted-foreground h-3 w-3" />
                            </button>
                          ) : (
                            <span title={live ? manageHint : undefined}>
                              {formatAdMoney(c.dailyBudgetInr, c.currency)}/day
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {c.insights ? (
                            <div
                              className={
                                showAsOf ? 'text-muted-foreground' : ''
                              }
                            >
                              {formatAdMoney(c.insights.spend, c.currency)}
                              {showAsOf && c.insights.fetchedAt && (
                                <span className="block text-[10px]">
                                  as of {formatRelative(c.insights.fetchedAt)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
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
                          {archived ? (
                            <span title="Spend was frozen when this ad was archived, while leads keep counting over a rolling 30 days, so the two no longer match.">
                              —
                            </span>
                          ) : c.costPerLeadInr !== null ? (
                            formatAdMoney(c.costPerLeadInr, c.currency)
                          ) : noLeadsYet ? (
                            <span className="text-xs">No leads yet</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-3">
                          {canEdit && c.status !== 'ARCHIVED' && (
                            <div className="flex items-center justify-end gap-1">
                              {c.status === 'ACTIVE' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Pause ad for ${c.propertyTitle}`}
                                  title={manageHint ?? 'Pause ad'}
                                  onClick={() => runAction(c, 'pause')}
                                  disabled={busyId === c.id || !canManage}
                                >
                                  <Pause className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {c.status === 'PAUSED' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Resume ad for ${c.propertyTitle}`}
                                  title={manageHint ?? 'Resume ad'}
                                  onClick={() => runAction(c, 'resume')}
                                  disabled={busyId === c.id || !canManage}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  aria-label={`More actions for ${c.propertyTitle}`}
                                  title="More actions"
                                  disabled={busyId === c.id}
                                  className="hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-50"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={!canManage}
                                    onClick={() => setArchiveTarget(c)}
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                    Archive ad
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this ad?</DialogTitle>
            <DialogDescription>
              {archiveTarget?.propertyTitle} will stop running on Instagram
              &amp; Facebook. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmArchive}>
              Archive ad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
