'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BarChart } from '@/components/tremor/bar-chart';
import type {
  KeyDashboard,
  KeyDashboardEntry,
  Pricing,
  UsageBucket,
} from '@/lib/ai/keys-admin';

const QUERY_KEY = ['admin-ai-keys'];
const DAYS = 30;

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `Request failed (${res.status})`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).data as T;
}

const usd = (value: number) =>
  value < 0.01 && value > 0
    ? `$${value.toFixed(4)}`
    : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const money = (amount: number, currency: 'USD' | 'INR') =>
  currency === 'INR'
    ? `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    : usd(amount);

const tokens = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(2)}M`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(value);

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const STATUS_STYLES: Record<KeyDashboardEntry['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  resting: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  disabled: 'bg-slate-700/40 text-slate-400 border-slate-600',
  unmanaged: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

function Usage({ label, bucket }: { label: string; bucket: UsageBucket }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
      <p className="text-[11px] tracking-wide text-slate-500 uppercase">
        {label}
      </p>
      <p className="text-base font-bold text-white">{usd(bucket.costUsd)}</p>
      <p className="text-xs text-slate-400">
        {bucket.calls.toLocaleString()} calls · {tokens(bucket.promptTokens)} in
        / {tokens(bucket.responseTokens)} out
        {bucket.failures ? (
          <span className="text-rose-400"> · {bucket.failures} failed</span>
        ) : null}
      </p>
    </div>
  );
}

function KeyCard({
  entry,
  inrPerUsd,
}: {
  entry: KeyDashboardEntry;
  inrPerUsd: number;
}) {
  const queryClient = useQueryClient();
  const [topupOpen, setTopupOpen] = useState(false);
  const [topup, setTopup] = useState({
    amount: '',
    currency: 'INR' as 'USD' | 'INR',
    topped_up_at: '',
    note: '',
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/admin/ai-keys/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () =>
      api(`/api/admin/ai-keys/${entry.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`Removed ${entry.label}`);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; error?: string; latency_ms?: number }>(
        `/api/admin/ai-keys/${entry.id}/test`,
        { method: 'POST' }
      ),
    onSuccess: (result) => {
      if (result.ok)
        toast.success(`${entry.label} works (${result.latency_ms} ms)`);
      else toast.error(`${entry.label}: ${result.error}`);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addTopup = useMutation({
    mutationFn: () =>
      api(`/api/admin/ai-keys/${entry.id}/topups`, {
        method: 'POST',
        body: JSON.stringify(topup),
      }),
    onSuccess: () => {
      toast.success('Top-up recorded');
      setTopupOpen(false);
      setTopup({ amount: '', currency: 'INR', topped_up_at: '', note: '' });
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeTopup = useMutation({
    mutationFn: (topupId: string) =>
      api(`/api/admin/ai-keys/${entry.id}/topups/${topupId}`, {
        method: 'DELETE',
      }),
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const remaining = entry.estimatedRemaining;
  const lastTopup = entry.lastTopup;
  const remainingPct =
    remaining && lastTopup
      ? Math.max(0, Math.min(100, (remaining.amount / lastTopup.amount) * 100))
      : null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-base font-bold text-white">
            <KeyRound className="h-4 w-4 text-slate-400" />
            {entry.label}
            {entry.hint && (
              <span className="font-mono text-xs text-slate-500">
                {entry.hint}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {entry.managed
              ? `${entry.scope === 'import' ? 'Guidance import only' : 'All AI features'} · priority ${entry.priority}`
              : 'From environment variables — usage only'}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[entry.status]}`}
        >
          {entry.status === 'resting'
            ? `Resting until ${when(entry.resting_until)}`
            : entry.status}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Usage label="Today" bucket={entry.today} />
        <Usage label="This month" bucket={entry.month} />
      </div>

      {entry.managed && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] tracking-wide text-slate-500 uppercase">
              Credits
            </p>
            <button
              type="button"
              onClick={() => setTopupOpen((open) => !open)}
              className="text-primary text-xs hover:underline"
            >
              {topupOpen ? 'Cancel' : 'Record top-up'}
            </button>
          </div>
          {remaining && lastTopup && entry.sinceTopup ? (
            <>
              <p className="text-base font-bold text-white">
                ~{money(remaining.amount, remaining.currency)} left
                <span className="ml-2 text-xs font-normal text-slate-400">
                  of {money(lastTopup.amount, lastTopup.currency)} on{' '}
                  {when(lastTopup.topped_up_at).split(',')[0]}
                </span>
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full ${remainingPct !== null && remainingPct < 15 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                  style={{ width: `${remainingPct ?? 0}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Spent since top-up {usd(entry.sinceTopup.costUsd)}
                {lastTopup.currency === 'INR'
                  ? ` (≈ ₹${Math.round(entry.sinceTopup.costUsd * inrPerUsd).toLocaleString('en-IN')})`
                  : ''}{' '}
                · estimate from tokens × price
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              Record a top-up to see an estimated balance. Google does not
              expose the real balance.
            </p>
          )}
          {topupOpen && (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Input
                type="number"
                min={1}
                placeholder="Amount"
                value={topup.amount}
                onChange={(e) => setTopup({ ...topup, amount: e.target.value })}
                className="h-8 border-slate-700 bg-slate-950 text-xs"
              />
              <select
                value={topup.currency}
                onChange={(e) =>
                  setTopup({
                    ...topup,
                    currency: e.target.value as 'USD' | 'INR',
                  })
                }
                className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
              <Input
                type="date"
                value={topup.topped_up_at}
                onChange={(e) =>
                  setTopup({ ...topup, topped_up_at: e.target.value })
                }
                className="h-8 border-slate-700 bg-slate-950 text-xs"
              />
              <Button
                size="sm"
                disabled={addTopup.isPending || !topup.amount}
                onClick={() => addTopup.mutate()}
              >
                {addTopup.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="mr-1 h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          )}
          {entry.topups.length > 1 && (
            <details className="mt-2 text-xs text-slate-400">
              <summary className="cursor-pointer">
                {entry.topups.length} top-ups
              </summary>
              <ul className="mt-1 space-y-1">
                {entry.topups.map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <span>
                      {money(t.amount, t.currency)} ·{' '}
                      {when(t.topped_up_at).split(',')[0]}
                      {t.note ? ` · ${t.note}` : ''}
                    </span>
                    <button
                      type="button"
                      aria-label="Delete top-up"
                      onClick={() => removeTopup.mutate(t.id)}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {entry.last_error && (
        <p className="truncate text-xs text-rose-400" title={entry.last_error}>
          {when(entry.last_error_at)}: {entry.last_error}
        </p>
      )}
      <p className="text-xs text-slate-500">
        Last used {when(entry.last_used_at)}
      </p>

      {entry.managed && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-1 h-4 w-4" />
            )}
            Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={patch.isPending}
            onClick={() => patch.mutate({ enabled: !entry.enabled })}
          >
            {entry.enabled ? 'Disable' : 'Enable'}
          </Button>
          {(entry.status === 'resting' || entry.last_error) && (
            <Button
              variant="outline"
              size="sm"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ reset: true })}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              Reset
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate({
                scope: entry.scope === 'import' ? 'general' : 'import',
              })
            }
          >
            {entry.scope === 'import' ? 'Use for all features' : 'Import only'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove key "${entry.label}"?`))
                remove.mutate();
            }}
            className="text-rose-400 hover:text-rose-300"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function AddKeyCard() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    label: '',
    key: '',
    scope: 'general',
    priority: '0',
  });
  const create = useMutation({
    mutationFn: () =>
      api('/api/admin/ai-keys', {
        method: 'POST',
        body: JSON.stringify({ ...form, priority: Number(form.priority) }),
      }),
    onSuccess: () => {
      toast.success(`Added ${form.label}`);
      setForm({ label: '', key: '', scope: 'general', priority: '0' });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        <Plus className="h-4 w-4" />
        Add a Gemini key
      </h3>
      <p className="text-xs text-slate-400">
        Stored encrypted with the same key as WhatsApp tokens. Both the web app
        and the WhatsApp worker pick it up within a minute — no redeploy. Lower
        priority is tried first; a key that runs out rests for ten minutes and
        the next one takes over.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-slate-400">Label</Label>
          <Input
            placeholder="praneeku@gmail.com"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="border-slate-700 bg-slate-950"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">API key</Label>
          <Input
            type="password"
            autoComplete="off"
            placeholder="AIza…"
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            className="border-slate-700 bg-slate-950"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Used for</Label>
          <select
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white"
          >
            <option value="general">All AI features</option>
            <option value="import">Guidance value import only</option>
          </select>
        </div>
        <div>
          <Label className="text-xs text-slate-400">Priority</Label>
          <Input
            type="number"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="border-slate-700 bg-slate-950"
          />
        </div>
      </div>
      <Button
        disabled={create.isPending || !form.label || !form.key}
        onClick={() => create.mutate()}
      >
        {create.isPending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-1 h-4 w-4" />
        )}
        Add key
      </Button>
    </div>
  );
}

function PricingCard({ pricing }: { pricing: Pricing }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Pricing>(pricing);
  const save = useMutation({
    mutationFn: () =>
      api('/api/admin/ai-keys/pricing', {
        method: 'PUT',
        body: JSON.stringify(draft),
      }),
    onSuccess: () => {
      toast.success('Prices saved');
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const setModel = (model: string, field: 'input' | 'output', value: string) =>
    setDraft({
      ...draft,
      models: {
        ...draft.models,
        [model]: { ...draft.models[model], [field]: Number(value) },
      },
    });

  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <summary className="cursor-pointer text-sm font-bold text-white">
        Prices used for estimates (USD per 1M tokens)
      </summary>
      <p className="mt-2 text-xs text-slate-400">
        Defaults are Google&apos;s published paid-tier prices at the time this
        was built. Check them against Google&apos;s pricing page and adjust
        here; estimates update immediately.
      </p>
      <div className="mt-3 space-y-2">
        {Object.entries(draft.models).map(([model, price]) => (
          <div key={model} className="grid items-center gap-2 sm:grid-cols-3">
            <span className="font-mono text-xs text-slate-300">{model}</span>
            <Input
              type="number"
              step="0.01"
              aria-label={`${model} input price`}
              value={price.input}
              onChange={(e) => setModel(model, 'input', e.target.value)}
              className="h-8 border-slate-700 bg-slate-950 text-xs"
            />
            <Input
              type="number"
              step="0.01"
              aria-label={`${model} output price`}
              value={price.output}
              onChange={(e) => setModel(model, 'output', e.target.value)}
              className="h-8 border-slate-700 bg-slate-950 text-xs"
            />
          </div>
        ))}
        <div className="grid items-center gap-2 sm:grid-cols-3">
          <span className="text-xs text-slate-300">₹ per $1</span>
          <Input
            type="number"
            step="0.1"
            aria-label="INR per USD"
            value={draft.inrPerUsd}
            onChange={(e) =>
              setDraft({ ...draft, inrPerUsd: Number(e.target.value) })
            }
            className="h-8 border-slate-700 bg-slate-950 text-xs"
          />
        </div>
      </div>
      <Button
        size="sm"
        className="mt-3"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Save prices
      </Button>
    </details>
  );
}

export default function AiKeysTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<KeyDashboard>(`/api/admin/ai-keys?days=${DAYS}`),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading AI keys…
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-rose-400">
        {error instanceof Error ? error.message : 'Could not load AI keys.'}
      </p>
    );
  }

  const managed = data.keys.filter((k) => k.managed);
  const totalToday = data.keys.reduce((sum, k) => sum + k.today.costUsd, 0);
  const totalMonth = data.keys.reduce((sum, k) => sum + k.month.costUsd, 0);
  const activeCount = managed.filter((k) => k.status === 'active').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Activity className="h-5 w-5" />
          AI keys
        </h2>
        <p className="text-sm text-slate-400">
          Gemini keys used by the web app and the WhatsApp worker, with live
          usage from every call. Refreshes every 30 seconds.
          {managed.length === 0 && (
            <>
              {' '}
              No keys are managed here yet, so the app is using{' '}
              {data.envFallback.primary ? 'GEMINI_API_KEY' : 'no key'}
              {data.envFallback.fallbacks
                ? ` plus ${data.envFallback.fallbacks} fallback${data.envFallback.fallbacks > 1 ? 's' : ''}`
                : ''}{' '}
              from the environment. Add the same keys below to manage them from
              here.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">
            Estimated spend today
          </p>
          <p className="text-2xl font-bold text-white">{usd(totalToday)}</p>
          <p className="text-xs text-slate-400">
            ≈ ₹
            {Math.round(totalToday * data.pricing.inrPerUsd).toLocaleString(
              'en-IN'
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">
            This month
          </p>
          <p className="text-2xl font-bold text-white">{usd(totalMonth)}</p>
          <p className="text-xs text-slate-400">
            ≈ ₹
            {Math.round(totalMonth * data.pricing.inrPerUsd).toLocaleString(
              'en-IN'
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Keys</p>
          <p className="text-2xl font-bold text-white">
            {activeCount}
            <span className="text-base font-normal text-slate-400">
              {' '}
              / {managed.length} active
            </span>
          </p>
          <p className="text-xs text-slate-400">
            {managed.filter((k) => k.status === 'resting').length} resting ·{' '}
            {managed.filter((k) => k.status === 'disabled').length} disabled
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.keys.map((entry) => (
          <KeyCard
            key={entry.id ?? entry.label}
            entry={entry}
            inrPerUsd={data.pricing.inrPerUsd}
          />
        ))}
        <AddKeyCard />
      </div>

      {data.daily.keyLabels.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="mb-3 text-sm font-bold text-white">
              Estimated spend by key · last {data.days} days
            </h3>
            <BarChart
              data={data.daily.byKey}
              index="day"
              categories={data.daily.keyLabels}
              type="stacked"
              valueFormatter={usd}
              className="h-[240px]"
            />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="mb-3 text-sm font-bold text-white">
              Estimated spend by feature · last {data.days} days
            </h3>
            <BarChart
              data={data.daily.byFeature}
              index="day"
              categories={data.daily.features}
              type="stacked"
              valueFormatter={usd}
              className="h-[240px]"
            />
          </div>
        </div>
      )}

      <PricingCard key={JSON.stringify(data.pricing)} pricing={data.pricing} />
    </div>
  );
}
