'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  TDS_STATUSES,
  TDS_STATUS_LABELS,
  type DealFinancials,
  type TdsStatus,
  type TokenSource,
} from '@/lib/deals/financials';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';

interface FinancialsResponse extends DealFinancials {
  token_source: TokenSource;
  token: {
    source: TokenSource;
    amount: number | null;
    received_at: string | null;
    reference: string | null;
    status: string | null;
  };
  deal_room_id: string | null;
}

interface DealFinancialsPanelProps {
  dealId: string;
  canEdit: boolean;
}

type Draft = Record<keyof DealFinancials, string>;

const EMPTY: Draft = {
  agreed_consideration: '',
  registered_consideration: '',
  other_component: '',
  token_amount: '',
  token_received_at: '',
  token_instrument_ref: '',
  tds_status: '',
  tds_amount: '',
  payment_instrument_refs: '',
  brokerage_received_amount: '',
};

function toDraft(f: DealFinancials): Draft {
  const out = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as (keyof DealFinancials)[]) {
    const v = f[key];
    out[key] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

export function DealFinancialsPanel({
  dealId,
  canEdit,
}: DealFinancialsPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['deal-financials', dealId],
    queryFn: async (): Promise<FinancialsResponse> => {
      const response = await fetch(`/api/deals/${dealId}/financials`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load financials');
      return json.data;
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading financials…
      </div>
    );
  }

  return (
    <FinancialsForm
      key={JSON.stringify(data)}
      dealId={dealId}
      canEdit={canEdit}
      data={data}
    />
  );
}

function FinancialsForm({
  dealId,
  canEdit,
  data,
}: {
  dealId: string;
  canEdit: boolean;
  data: FinancialsResponse;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(data));
  const [saving, setSaving] = useState(false);

  const tokenSafe = data.token_source === 'token_safe';

  async function save() {
    const patch: Record<string, unknown> = {};
    const before = toDraft(data);
    for (const key of Object.keys(EMPTY) as (keyof DealFinancials)[]) {
      if (draft[key] === before[key]) continue;
      if (tokenSafe && key.startsWith('token_')) continue;
      patch[key] = draft[key] === '' ? null : draft[key];
    }
    if (Object.keys(patch).length === 0) {
      toast.message('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/deals/${dealId}/financials`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, source: 'web' }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Could not save');
      queryClient.setQueryData(['deal-financials', dealId], json.data);
      await queryClient.invalidateQueries({
        queryKey: ['deal-events', dealId],
      });
      toast.success('Financials saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const field = (
    key: keyof DealFinancials,
    label: string,
    type: 'money' | 'date' | 'text'
  ) => (
    <div>
      <Label htmlFor={`fin-${key}`}>{label}</Label>
      <Input
        id={`fin-${key}`}
        type={type === 'money' ? 'number' : type === 'date' ? 'date' : 'text'}
        inputMode={type === 'money' ? 'decimal' : undefined}
        min={type === 'money' ? 0 : undefined}
        value={draft[key]}
        disabled={!canEdit}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        className="border-slate-700 bg-slate-950"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Transaction financials
        </h3>
        <p className="text-xs text-slate-400">
          Internal record-keeping. Nothing here is shared outside the account,
          and the workspace does not compute tax or reconcile payments.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:grid-cols-2">
        {field('agreed_consideration', 'Agreed consideration', 'money')}
        {field('registered_consideration', 'Registered value', 'money')}
        {field('other_component', 'Other component', 'money')}
        {field('brokerage_received_amount', 'Brokerage received', 'money')}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            Token / advance
          </p>
          {tokenSafe && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
              <Lock className="h-3 w-3" />
              Recorded in Token Safe
            </span>
          )}
        </div>
        {tokenSafe ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] text-slate-500 uppercase">Amount</dt>
              <dd className="text-white">
                {data.token.amount != null
                  ? `Rs. ${formatIndianDigits(data.token.amount, 0)}`
                  : data.token.status
                    ? `Escrow ${data.token.status}`
                    : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500 uppercase">Received</dt>
              <dd className="text-white">{data.token.received_at ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500 uppercase">
                Reference
              </dt>
              <dd className="text-white">{data.token.reference ?? '—'}</dd>
            </div>
          </dl>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {field('token_amount', 'Amount', 'money')}
            {field('token_received_at', 'Received on', 'date')}
            {field('token_instrument_ref', 'Instrument / UTR', 'text')}
          </div>
        )}
      </div>

      <div className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="fin-tds_status">TDS</Label>
          <select
            id="fin-tds_status"
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
            value={draft.tds_status}
            disabled={!canEdit}
            onChange={(e) =>
              setDraft((d) => ({ ...d, tds_status: e.target.value }))
            }
          >
            <option value="">—</option>
            {TDS_STATUSES.map((s: TdsStatus) => (
              <option key={s} value={s}>
                {TDS_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {field('tds_amount', 'TDS amount', 'money')}
        <div className="sm:col-span-2">
          <Label htmlFor="fin-payment_instrument_refs">
            Payment instrument references
          </Label>
          <Textarea
            id="fin-payment_instrument_refs"
            rows={3}
            placeholder="DD / RTGS / UTR numbers, one per line"
            value={draft.payment_instrument_refs}
            disabled={!canEdit}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                payment_instrument_refs: e.target.value,
              }))
            }
            className="border-slate-700 bg-slate-950"
          />
        </div>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save financials
          </Button>
        </div>
      )}
    </div>
  );
}
