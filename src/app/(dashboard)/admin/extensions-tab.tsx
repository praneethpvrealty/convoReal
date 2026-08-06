'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CalendarPlus,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PLAN_CONFIG } from '@/lib/billing/plan-config';
import {
  EXTENSION_REASONS,
  MAX_EXTENSION_DAYS,
} from '@/lib/billing/admin-extension';
import {
  buildExtensionFallbackText,
  REASON_SENTENCES,
  toneForReason,
} from '@/lib/whatsapp/subscription-extension-template';
import PlatformTemplatesCard from './platform-templates-card';
import type { Plan } from '@/lib/billing/types';

interface Organization {
  id: string;
  name: string;
  owner_email: string;
  status: string;
  plan: string;
}

interface ExtensionRow {
  id: string;
  account_id: string;
  account_name: string | null;
  days: number;
  extended_until: string;
  period_end_before: string | null;
  reason: string;
  note: string | null;
  incident_ref: string | null;
  granted_by_email: string | null;
  notified_at: string | null;
  notification_result: RecipientOutcome[] | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

interface RecipientOutcome {
  whatsapp?: { sent: boolean } | null;
  email?: { sent: boolean } | null;
  inApp?: { sent: boolean } | null;
}

interface PreviewAccount {
  accountId: string;
  name: string | null;
  plan: string;
  currentPeriodEnd: string | null;
  newPeriodEnd: string | null;
}

type Preview =
  | { action: 'grant'; days: number; accounts: PreviewAccount[] }
  | { action: 'revoke'; affectedCount: number; totalDays: number };

const REASON_LABELS: Record<string, string> = {
  outage: 'Outage',
  degraded_service: 'Degraded service',
  billing_error: 'Billing error',
  onboarding_delay: 'Onboarding delay',
  support_goodwill: 'Support goodwill',
};

function planName(plan: string) {
  return PLAN_CONFIG[plan as Plan]?.name ?? plan;
}

function shortDate(value: string | null) {
  return value ? format(new Date(value), 'd MMM yyyy') : '—';
}

/** Per-channel delivery at a glance. A grant is never rolled back for a
 *  failed send, so an un-delivered apology has to be visible here or it
 *  is lost. */
function DeliveryBadges({ row }: { row: ExtensionRow }) {
  if (!row.notified_at) return <span className="text-slate-600">Not sent</span>;

  const recipients = row.notification_result ?? [];
  const anySent = (
    pick: (r: RecipientOutcome) => { sent: boolean } | null | undefined
  ) => recipients.some((r) => pick(r)?.sent);

  const channels: [string, boolean][] = [
    ['WA', anySent((r) => r.whatsapp)],
    ['Email', anySent((r) => r.email)],
    ['App', anySent((r) => r.inApp)],
  ];

  return (
    <div className="flex flex-wrap gap-1">
      {channels.map(([label, sent]) => (
        <span
          key={label}
          title={sent ? `${label} delivered` : `${label} not delivered`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            sent
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export default function ExtensionsTab() {
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState<string>('outage');
  const [incidentRef, setIncidentRef] = useState('');
  const [note, setNote] = useState('');
  const [customerMessage, setCustomerMessage] = useState('');
  const [notify, setNotify] = useState(true);

  // Step-up state — a pending request is held here until its WhatsApp
  // code is verified. `payload` is replayed verbatim to the apply route
  // so the hash the challenge was bound to still matches.
  const [pending, setPending] = useState<{
    kind: 'grant' | 'revoke';
    endpoint: string;
    payload: Record<string, unknown>;
    challengeId: string;
    preview: Preview;
  } | null>(null);
  const [code, setCode] = useState('');

  const orgsQuery = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: async (): Promise<Organization[]> => {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to load organizations');
      return (await res.json()).organizations ?? [];
    },
  });

  const extensionsQuery = useQuery({
    queryKey: ['admin-subscription-extensions'],
    queryFn: async (): Promise<ExtensionRow[]> => {
      const res = await fetch('/api/admin/subscription-extensions');
      if (!res.ok) throw new Error('Failed to load extensions');
      return (await res.json()).extensions ?? [];
    },
  });

  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);

  const tone = toneForReason(reason);
  // Rendered from the same builder the send path uses, so what the admin
  // approves is literally what goes out.
  const previewText = useMemo(
    () =>
      buildExtensionFallbackText({
        contactName: null,
        reason,
        customerMessage: customerMessage.trim() || null,
        days,
        newPeriodEnd: null,
      }),
    [reason, customerMessage, days]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter(
      (o) =>
        (o.name ?? '').toLowerCase().includes(q) ||
        (o.owner_email ?? '').toLowerCase().includes(q)
    );
  }, [organizations, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPaid() {
    setSelected(
      new Set(
        organizations
          .filter((o) => o.plan !== 'starter' && o.status === 'active')
          .map((o) => o.id)
      )
    );
  }

  function resetForm() {
    setSelected(new Set());
    setNote('');
    setIncidentRef('');
    setCustomerMessage('');
    setNotify(true);
  }

  function closeOtp() {
    setPending(null);
    setCode('');
  }

  const challenge = useMutation({
    mutationFn: async (args: {
      kind: 'grant' | 'revoke';
      endpoint: string;
      payload: Record<string, unknown>;
    }) => {
      const res = await fetch('/api/admin/subscription-extensions/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          args.kind === 'revoke'
            ? { ...args.payload, action: 'revoke' }
            : args.payload
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error || 'Failed to send verification code');
      return {
        ...args,
        challengeId: data.challengeId as string,
        preview: data.preview as Preview,
      };
    },
    onSuccess: (result) => {
      setPending(result);
      setCode('');
      toast.success('Verification code sent to your WhatsApp');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!pending) throw new Error('No pending request');
      const res = await fetch(pending.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pending.payload,
          challengeId: pending.challengeId,
          code,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        pending?.kind === 'revoke'
          ? `Revoked ${data.revoked} extension${data.revoked === 1 ? '' : 's'}`
          : `Granted ${data.days} day${data.days === 1 ? '' : 's'} to ${data.granted} account${data.granted === 1 ? '' : 's'}`
      );
      closeOtp();
      resetForm();
      queryClient.invalidateQueries({
        queryKey: ['admin-subscription-extensions'],
      });
    },
    onError: (err: Error) => {
      setCode('');
      toast.error(err.message);
    },
  });

  function requestGrant() {
    if (selected.size === 0) {
      toast.error('Select at least one organization');
      return;
    }
    if (selected.size > 1 && !incidentRef.trim()) {
      toast.error(
        'An incident reference is required when extending more than one account'
      );
      return;
    }
    challenge.mutate({
      kind: 'grant',
      endpoint: '/api/admin/subscription-extensions',
      payload: {
        accountIds: [...selected],
        days,
        reason,
        note: note.trim() || undefined,
        incidentRef: incidentRef.trim() || undefined,
        customerMessage: customerMessage.trim() || undefined,
        notify,
      },
    });
  }

  function requestRevoke(row: ExtensionRow) {
    challenge.mutate({
      kind: 'revoke',
      endpoint: '/api/admin/subscription-extensions/revoke',
      payload: { extensionIds: [row.id] },
    });
  }

  const rows = extensionsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PlatformTemplatesCard />

      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <CalendarPlus className="text-primary h-4 w-4" />
            Grant Service Credit
          </CardTitle>
          <CardDescription className="text-slate-400">
            Adds paid days to accounts affected by an outage or another
            disruption on our side. Applied on top of the gateway&apos;s own
            billing period, so a renewal never wipes it. Confirmed with a code
            sent to your WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold text-slate-300">Days</Label>
              <input
                type="number"
                min={1}
                max={MAX_EXTENSION_DAYS}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="focus:border-primary rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold text-slate-300">Reason</Label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="focus:border-primary rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
              >
                {EXTENSION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REASON_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold text-slate-300">
                Incident reference{' '}
                {selected.size > 1 && <span className="text-amber-400">*</span>}
              </Label>
              <input
                type="text"
                value={incidentRef}
                onChange={(e) => setIncidentRef(e.target.value)}
                placeholder="INC-2026-08-06"
                className="focus:border-primary rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold text-slate-300">
                Note (optional)
              </Label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="WhatsApp send failures, 3h"
                className="focus:border-primary rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-xs font-bold text-slate-300">
                  What the customer is told
                </Label>
                <p className="mt-0.5 text-xs text-slate-500">
                  Sent on WhatsApp, by email, and to their in-app bell — from
                  ConvoReal&apos;s own number, not the tenant&apos;s.
                </p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="accent-primary h-4 w-4"
                />
                Notify
              </label>
            </div>

            {notify ? (
              <>
                <textarea
                  value={customerMessage}
                  onChange={(e) =>
                    setCustomerMessage(e.target.value.slice(0, 600))
                  }
                  rows={2}
                  placeholder={REASON_SENTENCES[reason] ?? ''}
                  className="focus:border-primary w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600"
                />
                <p className="text-xs text-slate-500">
                  Leave blank to use the default line for this reason. The
                  internal note above is never shown to the customer.
                </p>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                  <p className="mb-1.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                    {tone === 'apology'
                      ? 'Apology message'
                      : 'Goodwill message'}{' '}
                    · preview
                  </p>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
                    {previewText}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-400">
                Silent grant — the customer will not be told. Use only to
                correct a mis-entered extension.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-bold text-slate-300">
                Affected organizations ({selected.size} selected)
              </Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllPaid}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  Select all active paid
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or owner email"
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pr-3 pl-9 text-sm text-white outline-none placeholder:text-slate-600"
              />
            </div>

            <div className="max-h-72 divide-y divide-slate-800 overflow-y-auto rounded-xl border border-slate-800">
              {orgsQuery.isLoading && (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  Loading organizations…
                </p>
              )}
              {!orgsQuery.isLoading && visible.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  No organizations match.
                </p>
              )}
              {visible.map((org) => (
                <label
                  key={org.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-950/40"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(org.id)}
                    onChange={() => toggle(org.id)}
                    className="accent-primary h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">
                      {org.name || 'Personal Account'}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {org.owner_email}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
                    {planName(org.plan)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={requestGrant}
              disabled={challenge.isPending || selected.size === 0}
              className="border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {challenge.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              Review &amp; send code
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="text-base text-white">
            Granted Extensions
          </CardTitle>
          <CardDescription className="text-slate-400">
            Most recent 100. Revoking stamps the row rather than deleting it, so
            both the grant and its withdrawal stay on the record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full border-collapse text-left text-sm text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-950/50 text-xs font-bold tracking-wider text-slate-400 uppercase">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Incident</th>
                  <th className="px-4 py-3">Access until</th>
                  <th className="px-4 py-3">Notified</th>
                  <th className="px-4 py-3">Granted by</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-slate-950/30 ${row.revoked_at ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {row.account_name || 'Personal Account'}
                      </div>
                      {row.note && (
                        <div className="text-xs text-slate-500">{row.note}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.revoked_at ? <s>{row.days}d</s> : `${row.days}d`}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {REASON_LABELS[row.reason] ?? row.reason}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.incident_ref ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-slate-500">
                        {shortDate(row.period_end_before)}
                      </span>
                      {' → '}
                      <span className="text-white">
                        {shortDate(row.extended_until)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <DeliveryBadges row={row} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <div>{row.granted_by_email ?? '—'}</div>
                      <div>{shortDate(row.created_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.revoked_at ? (
                        <span className="text-xs text-slate-500">
                          Revoked {shortDate(row.revoked_at)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => requestRevoke(row)}
                          disabled={challenge.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!extensionsQuery.isLoading && rows.length === 0 && (
              <div className="px-6 py-12 text-center text-slate-500">
                No service credit has been granted yet.
              </div>
            )}
            {extensionsQuery.isLoading && (
              <div className="px-6 py-12 text-center text-slate-500">
                Loading extensions…
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="border-primary/30 flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border bg-slate-900/95 p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="border-primary/30 bg-primary/15 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border">
                <ShieldCheck className="text-primary h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {pending.kind === 'revoke'
                    ? 'Confirm Revocation'
                    : 'Confirm Service Credit'}
                </h3>
                <p className="text-xs text-slate-400">
                  Verify with the code sent to your WhatsApp
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              {pending.preview.action === 'revoke' ? (
                <p className="text-sm text-slate-200">
                  Withdrawing{' '}
                  <strong className="text-amber-400">
                    {pending.preview.totalDays} day
                    {pending.preview.totalDays === 1 ? '' : 's'}
                  </strong>{' '}
                  across {pending.preview.affectedCount} extension
                  {pending.preview.affectedCount === 1 ? '' : 's'}.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-slate-200">
                    Adding{' '}
                    <strong className="text-primary">
                      {pending.preview.days} day
                      {pending.preview.days === 1 ? '' : 's'}
                    </strong>{' '}
                    to {pending.preview.accounts.length} account
                    {pending.preview.accounts.length === 1 ? '' : 's'}:
                  </p>
                  <div className="max-h-40 overflow-y-auto text-xs">
                    {pending.preview.accounts.map((a) => (
                      <div
                        key={a.accountId}
                        className="flex items-center justify-between gap-3 border-b border-slate-800 py-1.5 last:border-0"
                      >
                        <span className="truncate text-slate-300">
                          {a.name || 'Personal Account'}
                        </span>
                        <span className="shrink-0 font-mono text-slate-500">
                          {shortDate(a.currentPeriodEnd)}
                          {' → '}
                          <span className="text-emerald-400">
                            {shortDate(a.newPeriodEnd)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                apply.mutate();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-bold text-slate-300">
                  Verification Code
                </Label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  disabled={apply.isPending}
                  className="focus:border-primary w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center font-mono text-xl tracking-[0.5em] text-white outline-none disabled:opacity-50"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeOtp}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={apply.isPending || code.length !== 6}
                  className="border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {apply.isPending && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Verify &amp; Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
