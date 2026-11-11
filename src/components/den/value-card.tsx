'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Scale, TrendingUp, Wallet } from 'lucide-react';

import { formatINR } from './format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  VALUE_SOURCE_LABELS,
  missingValueMessage,
  valuedSummary,
  type PortfolioValue,
  type PropertyValue,
} from '@/lib/den/value-view';
import { MIN_MARKET_COMPARABLES } from '@/lib/market/valuation';

const VALUE_QUERY_KEY = ['den-value'];

async function fetchPortfolioValue(): Promise<PortfolioValue> {
  const res = await fetch('/api/den/value');
  if (!res.ok) throw new Error('Could not load your portfolio value');
  return res.json();
}

function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function PortfolioValueCard() {
  const { data, isPending, isError } = useQuery({
    queryKey: VALUE_QUERY_KEY,
    queryFn: fetchPortfolioValue,
  });

  if (isError) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-xs font-semibold">
          Your portfolio value could not be loaded. Refresh to try again.
        </CardContent>
      </Card>
    );
  }
  if (isPending || data.totals.properties === 0) return null;

  const { totals } = data;
  return (
    <Card className="border-primary/30">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <span className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Wallet className="text-primary h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-[11px] font-semibold">
            Portfolio value
          </p>
          <p className="text-xl leading-tight font-black">
            {totals.valued > 0 ? formatINR(totals.estimate) : '—'}
          </p>
          <p className="text-muted-foreground text-[11px] font-medium">
            {valuedSummary(totals, data.truncated)}
          </p>
        </div>
        <div className="text-muted-foreground flex flex-col gap-0.5 text-[11px] font-semibold">
          {totals.guidance_count > 0 && (
            <span>
              Guidance value {formatINR(totals.guidance)} (
              {totals.guidance_count})
            </span>
          )}
          {totals.market_count > 0 && (
            <span>
              Market range {formatINR(totals.market_low)} –{' '}
              {formatINR(totals.market_high)} ({totals.market_count})
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface PropertyValuePanelProps {
  propertyId: string;
  status: string | null;
  listingType: string | null;
}

export function PropertyValuePanel({
  propertyId,
  status,
  listingType,
}: PropertyValuePanelProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: VALUE_QUERY_KEY,
    queryFn: fetchPortfolioValue,
  });
  const value = data?.properties.find((p) => p.property_id === propertyId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">What this property is worth</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isError ? (
          <p className="text-muted-foreground text-xs font-semibold">
            The value could not be loaded. Refresh to try again.
          </p>
        ) : isPending ? (
          <p className="text-muted-foreground text-xs">Loading value…</p>
        ) : !value ? (
          <p className="text-muted-foreground text-xs font-semibold">
            {missingValueMessage(status, listingType)}
          </p>
        ) : (
          <PropertyValueRows key={value.declared ?? 'unset'} value={value} />
        )}
      </CardContent>
    </Card>
  );
}

function PropertyValueRows({ value }: { value: PropertyValue }) {
  const queryClient = useQueryClient();
  const [declared, setDeclared] = useState(
    value.declared ? String(value.declared) : ''
  );

  const save = useMutation({
    mutationFn: async (amount: number | null) => {
      const res = await fetch('/api/den/value', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: value.property_id,
          declared_value: amount,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Could not save your value');
      return body as PortfolioValue;
    },
    onSuccess: (fresh, amount) => {
      queryClient.setQueryData(VALUE_QUERY_KEY, fresh);
      toast.success(
        amount === null ? 'Your value was cleared.' : 'Your value was saved.'
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = declared.replace(/[,\s₹]/g, '');
    if (!cleaned) {
      save.mutate(null);
      return;
    }
    const amount = Number(cleaned);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a value in rupees, for example 8500000');
      return;
    }
    save.mutate(amount);
  };

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <Label htmlFor="d-declared" className="text-xs font-bold">
          {VALUE_SOURCE_LABELS.declared} (₹)
        </Label>
        <div className="flex gap-2">
          <Input
            id="d-declared"
            inputMode="numeric"
            placeholder={
              value.asking
                ? `Using your expected price, ${formatINR(value.asking)}`
                : 'What you believe it is worth today'
            }
            value={declared}
            onChange={(e) => setDeclared(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={save.isPending}
            className="text-xs font-bold"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        <p className="text-muted-foreground text-[11px] font-medium">
          Only you see this figure. It is not shown to your agency or to buyers.
          Clear the box and save to remove it.
        </p>
      </form>

      <div className="flex items-start gap-3">
        <Landmark className="text-primary mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">{VALUE_SOURCE_LABELS.guidance}</p>
          {value.guidance ? (
            <p className="text-muted-foreground text-[11px] font-medium">
              {formatINR(value.guidance.total)}, the government value on file
              for this property. A sale cannot be registered below it.
            </p>
          ) : (
            <p className="text-muted-foreground text-[11px] font-medium">
              Not on file for this property yet.{' '}
              <Link
                href="/den/guidance-value"
                className="text-primary font-bold hover:underline"
              >
                Find the guidance value
              </Link>
            </p>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <TrendingUp className="text-primary mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">{VALUE_SOURCE_LABELS.market}</p>
          {value.market ? (
            <p className="text-muted-foreground text-[11px] font-medium">
              {formatINR(value.market.low)} – {formatINR(value.market.high)},
              from {value.market.comparables} comparable listings in this
              locality ({monthLabel(value.market.period_month)}), at about ₹
              {value.market.rate_per_sqft.toLocaleString('en-IN')} per sq.ft.
              Asking prices, not registered sales.
            </p>
          ) : (
            <p className="text-muted-foreground text-[11px] font-medium">
              No market range yet. We show one only when at least{' '}
              {MIN_MARKET_COMPARABLES} comparable listings in this locality have
              a price and an area.
            </p>
          )}
        </div>
      </div>

      <div className="bg-muted/40 flex items-center gap-3 rounded-xl border px-3 py-2">
        <Scale className="text-primary h-4 w-4 shrink-0" />
        <p className="text-xs font-semibold">
          {value.estimate !== null && value.estimate_source
            ? `Counted in your portfolio at ${formatINR(value.estimate)} (${VALUE_SOURCE_LABELS[value.estimate_source].toLowerCase()}).`
            : 'Not counted in your portfolio value yet. Add your value to include it.'}
        </p>
      </div>
    </>
  );
}
