'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Store,
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  Play,
  Pause,
  Package,
  DollarSign,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

interface MarketplaceItem {
  id: string;
  source_type: 'template' | 'flow';
  source_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  trigger_type: string;
  published: boolean;
  price_cents: number;
  currency: string;
  created_at: string;
  node_count: number;
  stats: {
    provisioned: number;
    purchased: number;
    enabled: number;
  };
}

interface TemplateSource {
  source_type: 'template';
  source_id: string;
  name: string;
  description: string;
  node_count: number;
}

export default function MarketplaceTab() {
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [templateSources, setTemplateSources] = useState<TemplateSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [sourceType, setSourceType] = useState<'template' | 'flow'>('template');
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceCents, setPriceCents] = useState('0');
  const [currency, setCurrency] = useState('INR');
  const [publishNow, setPublishNow] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/marketplace/items');
        if (!res.ok) throw new Error(`Failed to load marketplace items: ${res.status}`);
        const data = (await res.json()) as {
          items: MarketplaceItem[];
          templateSources: TemplateSource[];
        };
        if (!cancelled) {
          setItems(data.items ?? []);
          setTemplateSources(data.templateSources ?? []);
        }
      } catch (err) {
        console.error(err);
        toast.error('Could not load marketplace catalog.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setSourceType('template');
    setSourceId('');
    setName('');
    setDescription('');
    setPriceCents('0');
    setCurrency('INR');
    setPublishNow(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(priceCents);
    if (Number.isNaN(price) || price < 0) {
      toast.error('Price must be a non-negative number.');
      return;
    }
    if (!sourceId.trim()) {
      toast.error(sourceType === 'template' ? 'Select a template.' : 'Enter a source flow ID.');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/admin/marketplace/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId.trim(),
          name: name.trim() || undefined,
          description: description.trim() || null,
          price_cents: price,
          currency,
          published: publishNow,
        }),
      });
      const json = (await res.json()) as { item?: MarketplaceItem; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Create failed: ${res.status}`);
      if (json.item) {
        setItems((prev) => [json.item!, ...prev]);
      }
      setCreateOpen(false);
      resetForm();
      toast.success(publishNow ? 'Item published to all accounts.' : 'Item saved as draft.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function togglePublished(item: MarketplaceItem) {
    const next = !item.published;
    try {
      const res = await fetch(`/api/admin/marketplace/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: next }),
      });
      const json = (await res.json()) as { item?: MarketplaceItem; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Update failed');
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, published: next } : i)),
      );
      toast.success(next ? 'Item published to all accounts.' : 'Item unpublished.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      toast.error(msg);
    }
  }

  async function updatePrice(item: MarketplaceItem) {
    const input = window.prompt(`New price in ${item.currency} (cents):`, String(item.price_cents));
    if (input === null) return;
    const price = Number(input);
    if (Number.isNaN(price) || price < 0) {
      toast.error('Invalid price.');
      return;
    }
    try {
      const res = await fetch(`/api/admin/marketplace/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_cents: price }),
      });
      const json = (await res.json()) as { item?: MarketplaceItem; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Update failed');
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, price_cents: price } : i)),
      );
      toast.success('Price updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      toast.error(msg);
    }
  }

  async function handleRefreshSnapshot(item: MarketplaceItem) {
    if (!window.confirm(`Refresh snapshot from ${item.source_type} "${item.source_id}"? Existing copies in accounts will not be affected.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/marketplace/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_snapshot: true }),
      });
      const json = (await res.json()) as { item?: MarketplaceItem; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Refresh failed');
      if (json.item) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? json.item! : i)));
      }
      toast.success('Snapshot refreshed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Refresh failed';
      toast.error(msg);
    }
  }

  async function handleReprovision(item: MarketplaceItem) {
    if (!window.confirm(`Provision "${item.name}" to all accounts that don't have it yet?`)) return;
    try {
      const res = await fetch(`/api/admin/marketplace/items/${item.id}/provision`, {
        method: 'POST',
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Provision failed');
      toast.success('Provisioning complete.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Provision failed';
      toast.error(msg);
    }
  }

  async function handleDelete(item: MarketplaceItem) {
    if (!window.confirm(`Delete "${item.name}" from the catalog? Account copies will remain.`)) return;
    try {
      const res = await fetch(`/api/admin/marketplace/items/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Delete failed');
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success('Item deleted.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
    }
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-white">Flow Marketplace</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Publish flows and templates to every account. Free items activate instantly; paid items require Razorpay checkout.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Publish item
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="h-10 w-10 text-slate-600" />
            <h3 className="mt-4 text-base font-medium text-white">No marketplace items yet</h3>
            <p className="mt-1 max-w-md text-sm text-slate-400">
              Publish a template or an existing admin flow to push a disabled copy into every account.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="mt-5">
              <Plus className="h-4 w-4" />
              Publish first item
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="bg-slate-900 border-slate-700">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base text-white">{item.name}</CardTitle>
                    <CardDescription className="text-xs text-slate-400 mt-1 line-clamp-2">
                      {item.description || 'No description'}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 text-[10px]',
                      item.published
                        ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400',
                    )}
                  >
                    {item.published ? 'Published' : 'Draft'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <span className="text-slate-500">Source</span>
                    <div className="font-medium text-slate-200 capitalize">
                      {item.source_type}: {item.source_id.slice(0, 16)}
                      {item.source_id.length > 16 ? '…' : ''}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <span className="text-slate-500">Price</span>
                    <div className="font-medium text-slate-200">
                      {item.price_cents === 0 ? 'Free' : `${(item.price_cents / 100).toFixed(2)} ${item.currency}`}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <span className="text-slate-500">Nodes</span>
                    <div className="font-medium text-slate-200">{item.node_count}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <span className="text-slate-500">Copies</span>
                    <div className="font-medium text-slate-200">
                      {item.stats.enabled} / {item.stats.provisioned + item.stats.purchased + item.stats.enabled}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => togglePublished(item)}
                    className={cn(
                      'rounded-lg text-xs',
                      item.published
                        ? 'border-amber-700/50 text-amber-300 hover:bg-amber-900/30'
                        : 'border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/30',
                    )}
                  >
                    {item.published ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                    {item.published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updatePrice(item)}
                    className="rounded-lg text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <DollarSign className="h-3 w-3 mr-1" />
                    Price
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRefreshSnapshot(item)}
                    className="rounded-lg text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReprovision(item)}
                    className="rounded-lg text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <Package className="h-3 w-3 mr-1" />
                    Provision
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(item)}
                    className="rounded-lg text-xs border-red-900/50 text-red-400 hover:bg-red-950/30 ml-auto"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg bg-slate-900 text-slate-100 border-slate-700">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Publish marketplace item</DialogTitle>
              <DialogDescription className="text-slate-400">
                Choose a template or admin flow to snapshot and distribute to all accounts.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Source type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceType('template')}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-sm text-left transition-colors',
                      sourceType === 'template'
                        ? 'border-primary bg-primary/10 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600',
                    )}
                  >
                    Template
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType('flow')}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-sm text-left transition-colors',
                      sourceType === 'flow'
                        ? 'border-primary bg-primary/10 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600',
                    )}
                  >
                    Existing flow
                  </button>
                </div>
              </div>

              {sourceType === 'template' ? (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-300">Template</label>
                  <select
                    value={sourceId}
                    onChange={(e) => {
                      setSourceId(e.target.value);
                      const t = templateSources.find((x) => x.source_id === e.target.value);
                      if (t) {
                        setName(t.name);
                        setDescription(t.description);
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Select a template</option>
                    {templateSources.map((t) => (
                      <option key={t.source_id} value={t.source_id}>
                        {t.name} ({t.node_count} nodes)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-300">Source flow ID</label>
                  <Input
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Display name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Premium real estate showcase"
                  className="bg-slate-800 border-slate-700"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Description</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description shown to users"
                  className="bg-slate-800 border-slate-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-300">Price (cents)</label>
                  <Input
                    type="number"
                    min={0}
                    value={priceCents}
                    onChange={(e) => setPriceCents(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-300">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-white">Publish immediately</div>
                  <p className="text-xs text-slate-500">Distribute a disabled copy to every account now.</p>
                </div>
                <input
                  type="checkbox"
                  checked={publishNow}
                  onChange={(e) => setPublishNow(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 h-4 w-4 cursor-pointer"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreateOpen(false);
                  resetForm();
                }}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !sourceId.trim()}>
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {publishNow ? 'Publish' : 'Save draft'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
