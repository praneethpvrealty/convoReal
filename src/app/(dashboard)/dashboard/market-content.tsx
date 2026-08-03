'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Building2,
  Clock,
  Loader2,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrencyShort } from '@/lib/currency-utils';
import { median } from '@/lib/market/stats-engine';
import {
  buildLocalityRows,
  cityOptions,
  marketMonths,
  priceTrend,
  titleCaseToken,
  type MarketStatsResponse,
} from '@/lib/market/view';
import { BarChart } from '@/components/tremor/bar-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function monthLabel(month: string) {
  return format(new Date(`${month}T00:00:00`), 'MMM yy');
}

export default function MarketContent() {
  const { accountId } = useAuth();
  const queryClient = useQueryClient();
  const [city, setCity] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);

  const statsQuery = useQuery({
    queryKey: ['market-stats', accountId],
    queryFn: async (): Promise<MarketStatsResponse> => {
      const res = await fetch('/api/market/stats');
      if (!res.ok) throw new Error('Failed to load market stats');
      return res.json();
    },
    enabled: !!accountId,
  });

  const data = statsQuery.data;
  const months = useMemo(() => (data ? marketMonths(data.supply) : []), [data]);
  const cities = useMemo(() => (data ? cityOptions(data.supply) : []), [data]);

  const activeCity = city ?? cities[0] ?? null;
  const activeMonth = month ?? months[months.length - 1] ?? null;

  const rows = useMemo(
    () =>
      data && activeCity && activeMonth
        ? buildLocalityRows(data, activeCity, activeMonth)
        : [],
    [data, activeCity, activeMonth]
  );

  const activeRowKey = selectedRowKey ?? rows[0]?.key ?? null;
  const trend = useMemo(
    () =>
      data && activeCity && activeRowKey
        ? priceTrend(data.supply, activeCity, activeRowKey)
        : [],
    [data, activeCity, activeRowKey]
  );

  async function setConsent(consent: boolean) {
    setConsentSaving(true);
    try {
      const res = await fetch('/api/account/data-sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Failed to update data sharing');
      }
      toast.success(consent ? 'Data sharing enabled' : 'Data sharing disabled');
      queryClient.invalidateQueries({ queryKey: ['market-stats', accountId] });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update data sharing'
      );
    } finally {
      setConsentSaving(false);
    }
  }

  if (statsQuery.isLoading) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Loading market data...
      </p>
    );
  }

  if (statsQuery.isError || !data) {
    return (
      <p className="py-16 text-center text-sm text-red-400">
        Failed to load market data. Ensure the account_locality_medians database
        function is deployed (migration 181).
      </p>
    );
  }

  if (!data.consent) {
    return (
      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldCheck className="h-8 w-8 text-slate-500" />
          <h3 className="text-lg font-bold text-white">
            See how your market is moving
          </h3>
          <p className="max-w-lg text-sm text-slate-400">
            Market insights are built from anonymized listing and buyer-demand
            data shared by participating consultants. No names, phone numbers or
            property identities are ever included, and a locality only appears
            once at least five different consultants contribute to it. Sharing
            works both ways — enable it to contribute your anonymized aggregates
            and unlock the market view.
          </p>
          {data.isOwner ? (
            <Button
              className="mt-2"
              disabled={consentSaving}
              onClick={() => setConsent(true)}
            >
              {consentSaving && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Enable data sharing
            </Button>
          ) : (
            <p className="text-xs text-slate-500">
              Only the account owner can enable data sharing.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0 && data.supply.length === 0) {
    return (
      <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Clock className="h-8 w-8 text-slate-500" />
          <h3 className="text-lg font-bold text-white">No market data yet</h3>
          <p className="max-w-lg text-sm text-slate-400">
            Market cells are computed nightly and only published once at least
            five different consultants share data for the same locality and
            month. Check back after more consultants in your area enable sharing.
          </p>
          {data.isOwner && (
            <button
              type="button"
              disabled={consentSaving}
              onClick={() => setConsent(false)}
              className="text-xs text-slate-500 underline-offset-2 hover:underline"
            >
              Disable data sharing
            </button>
          )}
        </CardContent>
      </Card>
    );
  }

  const latestDemandMonth = data.demand.reduce(
    (max, c) => (c.period_month > max ? c.period_month : max),
    ''
  );
  const totalBuyers = data.demand
    .filter((c) => c.period_month === latestDemandMonth)
    .reduce((sum, c) => sum + (c.buyer_count ?? 0), 0);
  const daysToSell = median(
    rows.map((r) => r.medianDaysToSell).filter((v): v is number => v != null)
  );

  const tiles = [
    {
      title: 'Localities Tracked',
      value: new Set(rows.map((r) => r.locality)).size.toLocaleString(),
      sub: activeCity ? titleCaseToken(activeCity) : '—',
      icon: MapPin,
    },
    {
      title: 'Listings This Month',
      value: rows.reduce((sum, r) => sum + r.listings, 0).toLocaleString(),
      sub: `${rows.reduce((sum, r) => sum + r.sold, 0).toLocaleString()} sold`,
      icon: Building2,
    },
    {
      title: 'Buyers in Demand',
      value: totalBuyers.toLocaleString(),
      sub: 'Across all shared localities',
      icon: Users,
    },
    {
      title: 'Median Days to Sell',
      value: daysToSell != null ? `${Math.round(daysToSell)}d` : '—',
      sub: 'In the selected city & month',
      icon: Clock,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Anonymized market benchmarks from participating consultants.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeCity ?? ''}
            onChange={(e) => {
              setCity(e.target.value);
              setSelectedRowKey(null);
            }}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          >
            {cities.map((c) => (
              <option key={c} value={c}>
                {titleCaseToken(c)}
              </option>
            ))}
          </select>
          <select
            value={activeMonth ?? ''}
            onChange={(e) => {
              setMonth(e.target.value);
              setSelectedRowKey(null);
            }}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.title}
            className="border-slate-700 bg-slate-900 ring-0 ring-transparent"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-slate-400">
                {tile.title}
              </CardTitle>
              <tile.icon className="text-primary h-4 w-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-white">{tile.value}</div>
              <p className="mt-1 text-xs text-slate-500">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="border-b border-slate-800 p-4">
          <h3 className="text-sm font-bold text-white">Localities</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Select a row to see its price trend. “You” compares the median price
            of your available listings against the market median.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No published cells for this city and month yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Locality</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Listings</th>
                  <th className="px-4 py-3 text-right">Median Price</th>
                  <th className="px-4 py-3 text-right">Sold</th>
                  <th className="px-4 py-3 text-right">Days to Sell</th>
                  <th className="px-4 py-3 text-right">Buyers</th>
                  <th className="px-4 py-3 text-right">You</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    onClick={() => setSelectedRowKey(row.key)}
                    className={cn(
                      'cursor-pointer border-b border-slate-800/60 transition-colors last:border-0 hover:bg-slate-800/40',
                      activeRowKey === row.key && 'bg-primary/5'
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-slate-200">
                      {titleCaseToken(row.locality)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {titleCaseToken(row.propertyType)}
                      {row.listingType !== 'sale' && (
                        <span className="ml-1 text-xs text-slate-500">
                          ({titleCaseToken(row.listingType)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.listings.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.medianPrice != null
                        ? formatCurrencyShort(row.medianPrice)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.sold.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.medianDaysToSell != null
                        ? `${Math.round(row.medianDaysToSell)}d`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.buyers.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.yourListings === 0 ? (
                        <span className="text-slate-600">—</span>
                      ) : row.priceDeltaPct == null ? (
                        <span className="text-slate-400">
                          {row.yourListings} listed
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-xs font-medium',
                            row.priceDeltaPct > 0
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-emerald-500/10 text-emerald-400'
                          )}
                          title={`Your median ${formatCurrencyShort(row.yourMedianPrice ?? 0)} across ${row.yourListings} listings`}
                        >
                          {row.priceDeltaPct > 0 ? '+' : ''}
                          {row.priceDeltaPct.toFixed(1)}% vs market
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {trend.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">
            Median Price Trend —{' '}
            {titleCaseToken(activeRowKey?.split('|')[0] ?? '')}
          </h3>
          <BarChart
            data={trend.map((t) => ({
              month: monthLabel(t.month),
              'Median price': t.medianPrice ?? 0,
            }))}
            index="month"
            categories={['Median price']}
            colors={['violet']}
            valueFormatter={(value) => formatCurrencyShort(value)}
            showLegend={false}
            className="h-[240px]"
          />
        </div>
      )}

      {data.isOwner && (
        <p className="text-right">
          <button
            type="button"
            disabled={consentSaving}
            onClick={() => setConsent(false)}
            className="text-xs text-slate-600 underline-offset-2 hover:text-slate-400 hover:underline"
          >
            Disable data sharing
          </button>
        </p>
      )}
    </div>
  );
}
