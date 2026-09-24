'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { todayDateKey } from '@/lib/deals/deadlines';
import {
  TRANCHE_LABEL_SUGGESTIONS,
  TRANCHE_STATUS_LABELS,
  trancheReceived,
  trancheStatus,
  type DealPaymentTranche,
  type TrancheSummary,
} from '@/lib/deals/tranches';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { cn } from '@/lib/utils';

interface ScheduleResponse {
  tranches: DealPaymentTranche[];
  summary: TrancheSummary;
}

const STATUS_CLASS: Record<ReturnType<typeof trancheStatus>, string> = {
  received: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  partial: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  overdue: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  due: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  scheduled: 'border-slate-700 bg-slate-800/60 text-slate-300',
};

async function call(
  url: string,
  init: RequestInit,
  fallback: string
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as {
    data?: unknown;
    error?: string;
  } | null;
  if (!res.ok) throw new Error(json?.error || fallback);
  return json?.data;
}

export function DealTranchesPanel({
  dealId,
  canEdit,
}: {
  dealId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [receiptFor, setReceiptFor] = useState<DealPaymentTranche | null>(null);
  const [receivedAt, setReceivedAt] = useState('');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [instrument, setInstrument] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['deal-tranches', dealId],
    queryFn: () =>
      call(
        `/api/deals/${dealId}/tranches`,
        { method: 'GET' },
        'Could not load the payment schedule'
      ) as Promise<ScheduleResponse>,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-tranches', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['focus'] }),
    ]);

  async function run(
    key: string,
    action: () => Promise<unknown>,
    done?: string
  ) {
    setBusyId(key);
    try {
      await action();
      await refresh();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  function add() {
    if (!label.trim() || !amount) return;
    void run(
      'add',
      async () => {
        await call(
          `/api/deals/${dealId}/tranches`,
          {
            method: 'POST',
            body: JSON.stringify({
              label: label.trim(),
              amount,
              due_date: dueDate || null,
              source: 'web',
            }),
          },
          'Could not add the tranche'
        );
        setLabel('');
        setAmount('');
        setDueDate('');
      },
      'Tranche added.'
    );
  }

  function openReceipt(t: DealPaymentTranche) {
    setReceiptFor(t);
    setReceivedAt(t.received_at ?? todayDateKey());
    setReceivedAmount(
      t.received_amount != null ? String(t.received_amount) : ''
    );
    setInstrument(t.instrument_ref ?? '');
  }

  function saveReceipt() {
    if (!receiptFor) return;
    const t = receiptFor;
    void run(
      t.id,
      async () => {
        await call(
          `/api/deals/${dealId}/tranches/${t.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              received_at: receivedAt || null,
              received_amount: receivedAmount === '' ? null : receivedAmount,
              instrument_ref: instrument || null,
              source: 'web',
            }),
          },
          'Could not record the receipt'
        );
        setReceiptFor(null);
      },
      'Receipt recorded.'
    );
  }

  function remove(t: DealPaymentTranche) {
    void run(
      t.id,
      () =>
        call(
          `/api/deals/${dealId}/tranches/${t.id}`,
          { method: 'DELETE', body: JSON.stringify({ source: 'web' }) },
          'Could not remove the tranche'
        ),
      'Tranche removed.'
    );
  }

  const today = todayDateKey();

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          Payment schedule
        </p>
        {data && data.summary.count > 0 && (
          <p className="text-[11px] text-slate-400">
            Scheduled Rs. {formatIndianDigits(data.summary.scheduled, 0)} ·
            Received Rs. {formatIndianDigits(data.summary.received, 0)} ·
            Outstanding{' '}
            <span className="font-semibold text-white">
              Rs. {formatIndianDigits(data.summary.outstanding, 0)}
            </span>
          </p>
        )}
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading schedule…
        </div>
      ) : data.tranches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
          No tranches yet. Add the token, the agreement and registration
          payments, and record each one as it comes in.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.tranches.map((t) => {
            const status = trancheStatus(t, today);
            const received = trancheReceived(t);
            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                    STATUS_CLASS[status]
                  )}
                >
                  {TRANCHE_STATUS_LABELS[status]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {t.label}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {[
                      t.due_date ? `due ${t.due_date}` : null,
                      t.received_at
                        ? `received ${t.received_at}${
                            received < t.amount
                              ? ` (Rs. ${formatIndianDigits(received, 0)})`
                              : ''
                          }`
                        : null,
                      t.instrument_ref,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-white">
                  Rs. {formatIndianDigits(t.amount, 0)}
                </span>
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === t.id}
                      onClick={() => openReceipt(t)}
                      className="h-7 px-2 text-[11px]"
                      title={
                        t.received_at
                          ? 'Edit the receipt'
                          : 'Record the receipt'
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t.received_at ? 'Receipt' : 'Received'}
                    </Button>
                    {!t.received_at && !(t.received_amount ?? 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === t.id}
                        onClick={() => remove(t)}
                        className="h-7 px-2 text-slate-500 hover:text-rose-300"
                        title="Remove this tranche"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && receiptFor && (
        <div className="mt-3 grid gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3 sm:grid-cols-4">
          <p className="text-xs text-slate-300 sm:col-span-4">
            Receipt for{' '}
            <span className="font-semibold text-white">{receiptFor.label}</span>{' '}
            (Rs. {formatIndianDigits(receiptFor.amount, 0)})
          </p>
          <div>
            <Label htmlFor="tr-received-at">Received on</Label>
            <Input
              id="tr-received-at"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div>
            <Label htmlFor="tr-received-amount">Amount (blank = full)</Label>
            <Input
              id="tr-received-amount"
              type="number"
              min={0}
              inputMode="decimal"
              value={receivedAmount}
              onChange={(e) => setReceivedAmount(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div>
            <Label htmlFor="tr-instrument">Instrument / UTR</Label>
            <Input
              id="tr-instrument"
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              size="sm"
              disabled={busyId === receiptFor.id}
              onClick={saveReceipt}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReceiptFor(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="tr-label">Tranche</Label>
            <Input
              id="tr-label"
              list="tr-label-suggestions"
              placeholder="Token, On agreement, On registration…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
            <datalist id="tr-label-suggestions">
              {TRANCHE_LABEL_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="tr-amount">Amount</Label>
            <Input
              id="tr-amount"
              type="number"
              min={0}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div>
            <Label htmlFor="tr-due">Due on</Label>
            <div className="flex gap-2">
              <Input
                id="tr-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border-slate-700 bg-slate-950"
              />
              <Button
                size="sm"
                className="h-9 shrink-0"
                disabled={busyId === 'add' || !label.trim() || !amount}
                onClick={add}
                title="Add this tranche"
              >
                {busyId === 'add' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
