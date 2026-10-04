'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
  Store,
  Lock,
  ShoppingCart,
  Power,
  CheckCircle2,
} from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useCan';
import { openRazorpayCheckout } from '@/lib/marketplace/checkout';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { TabSkeleton } from '@/components/dashboard/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format/date';

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const STATUS_COLORS: Record<FlowRow['status'], string> = {
  draft: 'border-slate-700 bg-slate-800 text-slate-300',
  active: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
  archived: 'border-slate-700 bg-slate-800/50 text-slate-500',
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: 'MessageSquare' | 'HelpCircle' | 'UserPlus';
  trigger_type: string;
  node_count: number;
}

interface MarketplaceItemSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  trigger_type: string;
  price_cents: number;
  currency: string;
  account_status: 'provisioned' | 'purchased' | 'enabled' | null;
  account_flow_id: string | null;
  purchased_at: string | null;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export async function fetchFlows(): Promise<FlowRow[]> {
  const res = await fetch('/api/flows');
  if (!res.ok) throw new Error(`Failed to load flows: ${res.status}`);
  const json = (await res.json()) as { flows?: FlowRow[] };
  return json.flows ?? [];
}

async function fetchTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch('/api/flows/templates');
  if (!res.ok) return [];
  const json = (await res.json()) as { templates?: TemplateSummary[] };
  return json.templates ?? [];
}

export async function fetchMarketplaceItems(): Promise<
  MarketplaceItemSummary[]
> {
  const res = await fetch('/api/marketplace/items');
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: MarketplaceItemSummary[] };
  return json.items ?? [];
}

export function formatItemPrice(cents: number, currency: string): string {
  if (cents === 0) return 'Free';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function goLiveConsequence(triggerType: string): string {
  if (triggerType === 'first_inbound_message') {
    return 'Will reply to every first-time customer.';
  }
  if (triggerType === 'keyword') {
    return 'Will reply to every customer who sends one of its keywords.';
  }
  if (triggerType === 'manual') {
    return 'Will run only when someone on your team starts it.';
  }
  return 'Will start replying to customers automatically.';
}

export default function FlowsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const canCreate = useCan('send-messages');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<MarketplaceItemSummary | null>(
    null
  );

  const flowsKey = ['flows', accountId];
  const marketKey = ['marketplace-items', accountId];
  const flowsQuery = useQuery({
    queryKey: flowsKey,
    queryFn: fetchFlows,
    enabled: Boolean(accountId),
  });
  const templatesQuery = useQuery({
    queryKey: ['flow-templates'],
    queryFn: fetchTemplates,
  });
  const marketQuery = useQuery({
    queryKey: marketKey,
    queryFn: fetchMarketplaceItems,
    enabled: Boolean(accountId),
  });
  const flows = flowsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const marketplaceItems = marketQuery.data ?? [];

  const setMarketplaceItem = (item: MarketplaceItemSummary) =>
    queryClient.setQueryData<MarketplaceItemSummary[]>(marketKey, (prev) =>
      prev?.map((i) => (i.id === item.id ? item : i))
    );

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: 'keyword',
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName('');
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't create flow.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clone failed';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      `Delete "${flow.name}"? Any active runs will end immediately.`
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      queryClient.setQueryData<FlowRow[]>(flowsKey, (prev) =>
        prev?.filter((f) => f.id !== flow.id)
      );
      toast.success('Flow deleted.');
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete flow.");
    }
  }

  async function handleActivateMarketplaceItem(item: MarketplaceItemSummary) {
    setActivatingId(item.id);
    try {
      const res = await fetch(`/api/marketplace/items/${item.id}/activate`, {
        method: 'POST',
      });
      const json = (await res.json()) as {
        success?: boolean;
        flow_id?: string;
        error?: string;
      };
      if (!res.ok)
        throw new Error(json.error ?? `Activation failed: ${res.status}`);
      setConfirmItem(null);
      setMarketplaceItem({
        ...item,
        account_status: 'enabled',
        account_flow_id: json.flow_id ?? item.account_flow_id,
      });
      queryClient.invalidateQueries({ queryKey: flowsKey });
      toast.success('Flow activated.');
      if (json.flow_id) {
        router.push(`/flows/${json.flow_id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Activation failed';
      toast.error(msg);
    } finally {
      setActivatingId(null);
    }
  }

  async function handleBuyMarketplaceItem(item: MarketplaceItemSummary) {
    setActivatingId(item.id);
    try {
      const res = await fetch(`/api/marketplace/items/${item.id}/checkout`, {
        method: 'POST',
      });
      const json = (await res.json()) as {
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        itemName?: string;
        error?: string;
      };
      if (!res.ok)
        throw new Error(json.error ?? `Checkout failed: ${res.status}`);
      if (!json.orderId || !json.keyId)
        throw new Error('Missing checkout credentials');

      await openRazorpayCheckout({
        keyId: json.keyId,
        orderId: json.orderId,
        amount: json.amount ?? item.price_cents,
        currency: json.currency ?? item.currency,
        name: json.itemName ?? item.name,
        description: `Purchase ${item.name}`,
      });

      // Payment completed in the modal. Now poll for webhook confirmation.
      toast.loading('Processing payment...', { id: 'payment-processing' });

      // Poll for up to 10 seconds for the webhook to arrive
      let confirmed: MarketplaceItemSummary | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const statusRes = await fetch('/api/marketplace/items');
        if (statusRes.ok) {
          const statusJson = (await statusRes.json()) as {
            items: MarketplaceItemSummary[];
          };
          const updatedItem = statusJson.items.find((i) => i.id === item.id);

          if (
            updatedItem?.account_status === 'enabled' ||
            updatedItem?.account_status === 'purchased'
          ) {
            confirmed = updatedItem;
            setMarketplaceItem(updatedItem);
            break;
          }
        }
      }

      if (confirmed?.account_status === 'enabled') {
        toast.success('Payment successful. Your flow is now active.', {
          id: 'payment-processing',
        });
        if (confirmed.account_flow_id) {
          router.push(`/flows/${confirmed.account_flow_id}`);
        }
      } else if (confirmed) {
        toast.success(
          'Payment successful. Press Enable on the card to turn the flow on.',
          { id: 'payment-processing' }
        );
      } else {
        toast.success(
          "Payment received. We're still confirming it — refresh in a minute to enable the flow.",
          { id: 'payment-processing' }
        );
        queryClient.invalidateQueries({ queryKey: marketKey });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      toast.error(msg, { id: 'payment-processing' });
    } finally {
      setActivatingId(null);
    }
  }

  if (flowsQuery.isPending) {
    return <TabSkeleton label="Loading flows" />;
  }

  if (flowsQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
        <p className="text-sm text-rose-300">Couldn&apos;t load your flows.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => flowsQuery.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">Flows</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase">
              Beta
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Build branching, button-driven WhatsApp conversations. Useful for
            menus, FAQs, and triage before a human steps in.
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create flows"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New flow
        </GatedButton>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
            />
          ))}
        </div>
      )}

      {marketplaceItems.length > 0 && (
        <div className="space-y-4 border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2">
            <Store className="text-primary h-4 w-4" />
            <h2 className="text-base font-semibold text-white">Marketplace</h2>
            <span className="text-xs text-slate-500">
              Pre-built flows from the admin team
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {marketplaceItems.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                activating={activatingId === item.id}
                onActivate={() => setConfirmItem(item)}
                onBuy={() => handleBuyMarketplaceItem(item)}
                onEdit={() =>
                  item.account_flow_id &&
                  router.push(`/flows/${item.account_flow_id}`)
                }
              />
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={confirmItem !== null}
        onOpenChange={(open) => {
          if (!open && !activatingId) setConfirmItem(null);
        }}
      >
        <DialogContent className="bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Turn on {confirmItem?.name}?</DialogTitle>
            <DialogDescription className="text-slate-300">
              {confirmItem && goLiveConsequence(confirmItem.trigger_type)} It
              goes live as soon as you confirm, and you can pause it from the
              flow editor.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-800 bg-slate-900">
            <Button
              variant="ghost"
              onClick={() => setConfirmItem(null)}
              disabled={activatingId !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                confirmItem && handleActivateMarketplaceItem(confirmItem)
              }
              disabled={activatingId !== null}
            >
              {activatingId !== null && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="bg-slate-900 text-slate-100 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Create a new flow</DialogTitle>
            <DialogDescription className="text-slate-400">
              Start from a template or build from scratch.
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs tracking-wide text-slate-500 uppercase">
                Start from a template
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => handleUseTemplate(t.slug)}
                      disabled={creating}
                      className="hover:border-primary/40 flex flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-950 p-4 text-left transition-colors hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Icon className="text-primary h-5 w-5" />
                      <span className="text-sm font-semibold text-white">
                        {t.name}
                      </span>
                      <span className="text-xs leading-relaxed text-slate-400">
                        {t.description}
                      </span>
                      <span className="mt-auto border-t border-slate-800 pt-2 text-[11px] text-slate-500">
                        {t.node_count} {t.node_count === 1 ? 'node' : 'nodes'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-slate-800 pt-4">
            <p className="text-xs tracking-wide text-slate-500 uppercase">
              Or start blank
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Welcome menu"
              className="bg-slate-800"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create blank flow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
}: {
  onCreate: () => void;
  canCreate: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
        <Workflow className="h-6 w-6 text-slate-500" />
      </div>
      <h2 className="mt-4 text-base font-medium text-white">No flows yet</h2>
      <p className="mt-1 max-w-md text-sm text-slate-400">
        Build your first conversation — a welcome menu, an order lookup, an FAQ
        bot. Customers tap buttons; the bot routes them to the right answer (or
        the right agent).
      </p>
      <GatedButton
        canAct={canCreate}
        gateReason="create flows"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Create your first flow
      </GatedButton>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const triggerSummary = describeTrigger(flow);
  const StatusIcon =
    flow.status === 'active'
      ? PlayCircle
      : flow.status === 'archived'
        ? Archive
        : PauseCircle;
  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="text-primary h-4 w-4 shrink-0" />
          <h3 className="truncate text-sm font-semibold text-white">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 gap-1 text-[10px]',
            STATUS_COLORS[flow.status]
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count} {flow.execution_count === 1 ? 'run' : 'runs'}
        </span>
        {flow.last_executed_at && (
          <span>Last run {formatRelative(flow.last_executed_at)}</span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow): string {
  if (flow.trigger_type === 'keyword') {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return 'Triggers on keyword (none set)';
    return `Triggers on: ${keywords.join(', ')}`;
  }
  if (flow.trigger_type === 'first_inbound_message') {
    return "Triggers on a contact's first-ever inbound message";
  }
  return 'Manual trigger';
}

function MarketplaceCard({
  item,
  activating,
  onActivate,
  onBuy,
  onEdit,
}: {
  item: MarketplaceItemSummary;
  activating: boolean;
  onActivate: () => void;
  onBuy: () => void;
  onEdit: () => void;
}) {
  const isFree = item.price_cents === 0;
  const status = item.account_status;
  const isEnabled = status === 'enabled';
  const isPurchased = status === 'purchased';

  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Store className="text-primary h-4 w-4 shrink-0" />
          <h3 className="truncate text-sm font-semibold text-white">
            {item.name}
          </h3>
        </div>
        {isEnabled ? (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-emerald-600/40 bg-emerald-500/10 text-[10px] text-emerald-300"
          >
            <CheckCircle2 className="h-3 w-3" />
            Active
          </Badge>
        ) : isPurchased ? (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-blue-600/40 bg-blue-500/10 text-[10px] text-blue-300"
          >
            <Lock className="h-3 w-3" />
            Purchased
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-slate-700 bg-slate-800 text-[10px] text-slate-400"
          >
            <Store className="h-3 w-3" />
            Available
          </Badge>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
        {item.description ||
          describeTrigger({
            trigger_type: item.trigger_type,
            trigger_config: {},
          } as FlowRow)}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
        <span className="text-xs font-medium text-slate-300">
          {formatItemPrice(item.price_cents, item.currency)}
        </span>
        {isEnabled ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : isFree ? (
          <Button size="sm" onClick={onActivate} disabled={activating}>
            {activating && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            <Power className="mr-1 h-3.5 w-3.5" />
            Activate
          </Button>
        ) : isPurchased ? (
          <Button size="sm" onClick={onActivate} disabled={activating}>
            {activating && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            <Power className="mr-1 h-3.5 w-3.5" />
            Enable
          </Button>
        ) : (
          <Button size="sm" onClick={onBuy} disabled={activating}>
            {activating && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            <ShoppingCart className="mr-1 h-3.5 w-3.5" />
            Buy
          </Button>
        )}
      </div>
    </div>
  );
}
