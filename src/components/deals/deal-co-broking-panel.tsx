'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { todayDateKey } from '@/lib/deals/deadlines';
import {
  DEAL_POSITIONS,
  DEAL_POSITION_LABELS,
  PAYOUT_STATUS_LABELS,
  payoutFromPercent,
  payoutPaid,
  payoutStatus,
  type CoBrokingView,
  type DealCoBrokerPayout,
  type PayoutSide,
} from '@/lib/deals/co-broking';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<ReturnType<typeof payoutStatus>, string> = {
  paid: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  partial: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  owed: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

const SIDE_LABELS: Record<PayoutSide, string> = {
  buyer: "Buyer's agent",
  seller: "Seller's agent",
};

const OTHER = '__other__';

const selectClass =
  'h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white';

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

function rs(n: number): string {
  return `Rs. ${formatIndianDigits(n, 0)}`;
}

export function DealCoBrokingPanel({
  dealId,
  canEdit,
}: {
  dealId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payee, setPayee] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [side, setSide] = useState<PayoutSide | ''>('');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [paidFor, setPaidFor] = useState<DealCoBrokerPayout | null>(null);
  const [paidAt, setPaidAt] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [instrument, setInstrument] = useState('');
  const [editName, setEditName] = useState('');
  const [editSide, setEditSide] = useState<PayoutSide | ''>('');
  const [editAmount, setEditAmount] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['deal-co-broking', dealId],
    queryFn: () =>
      call(
        `/api/deals/${dealId}/co-broking`,
        { method: 'GET' },
        'Could not load co-broking'
      ) as Promise<CoBrokingView>,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-co-broking', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-workspace', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
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

  function savePosition(value: string) {
    void run(
      'position',
      () =>
        call(
          `/api/deals/${dealId}/co-broking`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              deal_position: value || null,
              source: 'web',
            }),
          },
          'Could not save the position'
        ),
      'Position saved.'
    );
  }

  function pickPayee(value: string) {
    setPayee(value);
    const broker = data?.brokers.find((b) => b.id === value);
    if (broker) {
      setPayeeName(broker.name);
      if (broker.side === 'buyer' || broker.side === 'seller') {
        setSide(broker.side);
      }
    } else {
      setPayeeName('');
    }
  }

  function changePercent(value: string) {
    setPercent(value);
    const computed = payoutFromPercent(data?.deal_value, value);
    if (computed > 0) setAmount(String(computed));
  }

  const name = payee && payee !== OTHER ? payeeName : payeeName.trim();

  function add() {
    if (!name || !amount) return;
    void run(
      'add',
      async () => {
        await call(
          `/api/deals/${dealId}/co-broking/payouts`,
          {
            method: 'POST',
            body: JSON.stringify({
              payee_name: name,
              stakeholder_id: payee && payee !== OTHER ? payee : null,
              side: side || null,
              share_percent: percent || null,
              amount,
              source: 'web',
            }),
          },
          'Could not add the payout'
        );
        setPayee('');
        setPayeeName('');
        setSide('');
        setPercent('');
        setAmount('');
      },
      'Payout added.'
    );
  }

  function openPayout(p: DealCoBrokerPayout, markPaid: boolean) {
    setPaidFor(p);
    setEditName(p.payee_name);
    setEditSide(p.side ?? '');
    setEditAmount(String(p.amount));
    setPaidAt(p.paid_at ?? (markPaid ? todayDateKey() : ''));
    setPaidAmount(p.paid_amount != null ? String(p.paid_amount) : '');
    setInstrument(p.instrument_ref ?? '');
  }

  function savePaid() {
    if (!paidFor) return;
    const p = paidFor;
    void run(
      p.id,
      async () => {
        await call(
          `/api/deals/${dealId}/co-broking/payouts/${p.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              payee_name: editName,
              side: editSide || null,
              amount: editAmount,
              paid_at: paidAt || null,
              paid_amount: paidAmount === '' ? null : paidAmount,
              instrument_ref: instrument || null,
              source: 'web',
            }),
          },
          'Could not save the payout'
        );
        setPaidFor(null);
      },
      'Payout saved.'
    );
  }

  function remove(p: DealCoBrokerPayout) {
    void run(
      p.id,
      () =>
        call(
          `/api/deals/${dealId}/co-broking/payouts/${p.id}`,
          { method: 'DELETE', body: JSON.stringify({ source: 'web' }) },
          'Could not remove the payout'
        ),
      'Payout removed.'
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          Co-broking
        </p>
        {data && data.payouts.length > 0 && (
          <p className="text-[11px] text-slate-400">
            {data.summary.collected !== null &&
              `Collected ${rs(data.summary.collected)} · `}
            Co-brokers {rs(data.summary.payouts)} · Paid out{' '}
            {rs(data.summary.paid_out)} · Still to pay {rs(data.summary.to_pay)}
            {data.summary.net !== null && (
              <>
                {' '}
                · Your share{' '}
                <span className="font-semibold text-white">
                  {rs(data.summary.net)}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading co-broking…
        </div>
      ) : (
        <>
          <div className="mb-3 max-w-md">
            <Label htmlFor="cb-position">Your position on this deal</Label>
            <select
              id="cb-position"
              className={selectClass}
              value={data.position ?? ''}
              disabled={!canEdit || busyId === 'position'}
              onChange={(e) => savePosition(e.target.value)}
            >
              <option value="">Not set</option>
              {DEAL_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {DEAL_POSITION_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {data.payouts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
              No co-brokers. If you collect the commission and pay the
              buyer&apos;s or seller&apos;s agent a share, add each one here.
              Your dashboards then count only your share.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.payouts.map((p) => {
                const status = payoutStatus(p);
                const paid = payoutPaid(p);
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                        STATUS_CLASS[status]
                      )}
                    >
                      {PAYOUT_STATUS_LABELS[status]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {p.payee_name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {[
                          p.side ? SIDE_LABELS[p.side] : null,
                          p.share_percent != null
                            ? `${p.share_percent}% of the deal`
                            : null,
                          p.paid_at
                            ? `paid ${p.paid_at}${
                                paid < p.amount ? ` (${rs(paid)})` : ''
                              }`
                            : null,
                          p.instrument_ref,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-white">
                      {rs(p.amount)}
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 items-center gap-1">
                        {status !== 'paid' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyId === p.id}
                            onClick={() => openPayout(p, true)}
                            className="h-7 px-2 text-[11px]"
                            title="Record the payment"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Paid
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => openPayout(p, false)}
                          className="h-7 px-2 text-[11px]"
                          title="Correct this payout"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!p.paid_at && !(p.paid_amount ?? 0) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyId === p.id}
                            onClick={() => remove(p)}
                            className="h-7 px-2 text-slate-500 hover:text-rose-300"
                            title="Remove this payout"
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

          {canEdit && paidFor && (
            <div className="mt-3 grid gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3 sm:grid-cols-4">
              <p className="text-xs text-slate-300 sm:col-span-4">
                Payout to{' '}
                <span className="font-semibold text-white">
                  {paidFor.payee_name}
                </span>
              </p>
              <div className="sm:col-span-2">
                <Label htmlFor="cb-edit-name">Broker</Label>
                <Input
                  id="cb-edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <Label htmlFor="cb-edit-side">Side</Label>
                <select
                  id="cb-edit-side"
                  className={selectClass}
                  value={editSide}
                  onChange={(e) =>
                    setEditSide(e.target.value as PayoutSide | '')
                  }
                >
                  <option value="">—</option>
                  <option value="buyer">{SIDE_LABELS.buyer}</option>
                  <option value="seller">{SIDE_LABELS.seller}</option>
                </select>
              </div>
              <div>
                <Label htmlFor="cb-edit-amount">Payout amount</Label>
                <Input
                  id="cb-edit-amount"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <Label htmlFor="cb-paid-at">Paid on</Label>
                <Input
                  id="cb-paid-at"
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className="border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <Label htmlFor="cb-paid-amount">Paid (blank = full)</Label>
                <Input
                  id="cb-paid-amount"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  className="border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <Label htmlFor="cb-instrument">Instrument / UTR</Label>
                <Input
                  id="cb-instrument"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className="border-slate-700 bg-slate-950"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  size="sm"
                  disabled={
                    busyId === paidFor.id || !editName.trim() || !editAmount
                  }
                  onClick={savePaid}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPaidFor(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="mt-3 grid gap-3 sm:grid-cols-5">
              <div className="sm:col-span-2">
                <Label htmlFor="cb-payee">Pay to</Label>
                {data.brokers.length > 0 && (
                  <select
                    id="cb-payee"
                    className={cn(selectClass, 'mb-2')}
                    value={payee}
                    onChange={(e) => pickPayee(e.target.value)}
                  >
                    <option value="">Pick a broker on this deal</option>
                    {data.brokers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                    <option value={OTHER}>Someone else</option>
                  </select>
                )}
                {(data.brokers.length === 0 || payee === OTHER) && (
                  <Input
                    id={
                      data.brokers.length === 0 ? 'cb-payee' : 'cb-payee-name'
                    }
                    placeholder="Broker or firm name"
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    className="border-slate-700 bg-slate-950"
                  />
                )}
              </div>
              <div>
                <Label htmlFor="cb-side">Side</Label>
                <select
                  id="cb-side"
                  className={selectClass}
                  value={side}
                  onChange={(e) => setSide(e.target.value as PayoutSide | '')}
                >
                  <option value="">—</option>
                  <option value="buyer">{SIDE_LABELS.buyer}</option>
                  <option value="seller">{SIDE_LABELS.seller}</option>
                </select>
              </div>
              <div>
                <Label htmlFor="cb-percent">% of deal</Label>
                <Input
                  id="cb-percent"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.5"
                  value={percent}
                  onChange={(e) => changePercent(e.target.value)}
                  className="border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <Label htmlFor="cb-amount">Amount</Label>
                <div className="flex gap-2">
                  <Input
                    id="cb-amount"
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="border-slate-700 bg-slate-950"
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={busyId === 'add' || !name || !amount}
                    onClick={add}
                    title="Add this payout"
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
          {canEdit && data.brokers.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Tip: add the other agents under Stakeholders with the role Broker,
              and they appear here to pick.
            </p>
          )}
        </>
      )}
    </div>
  );
}
