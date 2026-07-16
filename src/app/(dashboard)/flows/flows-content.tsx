"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
} from "lucide-react";

import { useCan } from "@/hooks/use-can";
import { openRazorpayCheckout } from "@/lib/marketplace/checkout";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { FlowNodeLoader } from "@/components/ui/flow-node-loader";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow["status"], string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-slate-700 bg-slate-800 text-slate-300",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
  archived: "border-slate-700 bg-slate-800/50 text-slate-500",
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
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
  account_status: "provisioned" | "purchased" | "enabled" | null;
  account_flow_id: string | null;
  purchased_at: string | null;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const canCreate = useCan("send-messages");
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItemSummary[]>([]);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes, marketRes] = await Promise.all([
          fetch("/api/flows"),
          fetch("/api/flows/templates"),
          fetch("/api/marketplace/items"),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
        if (marketRes.ok) {
          const marketJson = (await marketRes.json()) as {
            items: MarketplaceItemSummary[];
          };
          if (!cancelled) setMarketplaceItems(marketJson.items ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flows.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: "keyword",
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName("");
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
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const msg = err instanceof Error ? err.message : "Clone failed";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      `Delete "${flow.name}"? Any active runs will end immediately.`,
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success("Flow deleted.");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete flow.");
    }
  }

  async function handleActivateMarketplaceItem(item: MarketplaceItemSummary) {
    setActivatingId(item.id);
    try {
      const res = await fetch(`/api/marketplace/items/${item.id}/activate`, {
        method: "POST",
      });
      const json = (await res.json()) as { success?: boolean; flow_id?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Activation failed: ${res.status}`);
      setMarketplaceItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, account_status: "enabled" } : i)),
      );
      toast.success("Flow activated.");
      if (json.flow_id) {
        router.push(`/flows/${json.flow_id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Activation failed";
      toast.error(msg);
    } finally {
      setActivatingId(null);
    }
  }

  async function handleBuyMarketplaceItem(item: MarketplaceItemSummary) {
    setActivatingId(item.id);
    try {
      const res = await fetch(`/api/marketplace/items/${item.id}/checkout`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        itemName?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `Checkout failed: ${res.status}`);
      if (!json.orderId || !json.keyId) throw new Error("Missing checkout credentials");

      const result = await openRazorpayCheckout({
        keyId: json.keyId,
        orderId: json.orderId,
        amount: json.amount ?? item.price_cents,
        currency: json.currency ?? item.currency,
        name: json.itemName ?? item.name,
        description: `Purchase ${item.name}`,
      });

      // Payment completed in the modal. Now poll for webhook confirmation.
      toast.loading("Processing payment...", { id: "payment-processing" });
      
      // Poll for up to 10 seconds for the webhook to arrive
      let confirmed = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        
        const statusRes = await fetch("/api/marketplace/items");
        if (statusRes.ok) {
          const statusJson = (await statusRes.json()) as { items: MarketplaceItemSummary[] };
          const updatedItem = statusJson.items.find((i) => i.id === item.id);
          
          if (updatedItem?.account_status === "enabled" || updatedItem?.account_status === "purchased") {
            confirmed = true;
            // Update local state with the confirmed status
            setMarketplaceItems((prev) =>
              prev.map((i) => (i.id === item.id ? updatedItem : i)),
            );
            break;
          }
        }
      }

      if (confirmed) {
        toast.success("Payment successful. Your flow is now active.", { id: "payment-processing" });
        if (item.account_flow_id) {
          router.push(`/flows/${item.account_flow_id}`);
        }
      } else {
        // Webhook hasn't arrived yet, but payment was successful
        // Optimistically update and let the user refresh if needed
        setMarketplaceItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, account_status: "enabled" } : i)),
        );
        toast.success("Payment successful. Activating your flow...", { id: "payment-processing" });
      }
      
      console.log("Razorpay marketplace payment:", result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      toast.error(msg, { id: "payment-processing" });
    } finally {
      setActivatingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <FlowNodeLoader size={96} label="Loading flows" />
        <ConvoRealLoader size={18} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">Flows</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
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
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
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
                onActivate={() => handleActivateMarketplaceItem(item)}
                onBuy={() => handleBuyMarketplaceItem(item)}
                onEdit={() =>
                  item.account_flow_id && router.push(`/flows/${item.account_flow_id}`)
                }
              />
            ))}
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="sm:max-w-4xl bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Create a new flow</DialogTitle>
            <DialogDescription className="text-slate-400">
              Start from a template or build from scratch.
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
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
                      className="flex flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-950 p-4 text-left transition-colors hover:border-primary/40 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-white">
                        {t.name}
                      </span>
                      <span className="text-xs leading-relaxed text-slate-400">
                        {t.description}
                      </span>
                      <span className="mt-auto border-t border-slate-800 pt-2 text-[11px] text-slate-500">
                        {t.node_count} {t.node_count === 1 ? "node" : "nodes"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-slate-800 pt-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Or start blank
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Welcome menu"
              className="bg-slate-800"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
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
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
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
      <h2 className="mt-4 text-base font-medium text-white">
        No flows yet
      </h2>
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
    flow.status === "active"
      ? PlayCircle
      : flow.status === "archived"
        ? Archive
        : PauseCircle;
  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-white">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px]",
            STATUS_COLORS[flow.status],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count} {flow.execution_count === 1 ? "run" : "runs"}
        </span>
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
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return "Triggers on keyword (none set)";
    return `Triggers on: ${keywords.join(", ")}`;
  }
  if (flow.trigger_type === "first_inbound_message") {
    return "Triggers on a contact's first-ever inbound message";
  }
  return "Manual trigger";
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
  const isEnabled = status === "enabled";
  const isPurchased = status === "purchased";

  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Store className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-white">{item.name}</h3>
        </div>
        {isEnabled ? (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px] border-emerald-600/40 bg-emerald-500/10 text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            Active
          </Badge>
        ) : isPurchased ? (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px] border-blue-600/40 bg-blue-500/10 text-blue-300">
            <Lock className="h-3 w-3" />
            Purchased
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px] border-slate-700 bg-slate-800 text-slate-400">
            <PauseCircle className="h-3 w-3" />
            Disabled
          </Badge>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
        {item.description || describeTrigger({ trigger_type: item.trigger_type, trigger_config: {} } as FlowRow)}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
        <span className="text-xs font-medium text-slate-300">
          {isFree ? "Free" : `${(item.price_cents / 100).toFixed(2)} ${item.currency}`}
        </span>
        {isEnabled ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : isFree ? (
          <Button size="sm" onClick={onActivate} disabled={activating}>
            {activating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            <Power className="h-3.5 w-3.5 mr-1" />
            Activate
          </Button>
        ) : isPurchased ? (
          <Button size="sm" onClick={onActivate} disabled={activating}>
            {activating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            <Power className="h-3.5 w-3.5 mr-1" />
            Enable
          </Button>
        ) : (
          <Button size="sm" onClick={onBuy} disabled={activating}>
            {activating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            <ShoppingCart className="h-3.5 w-3.5 mr-1" />
            Buy
          </Button>
        )}
      </div>
    </div>
  );
}
