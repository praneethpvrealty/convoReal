'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Landmark, Loader2, Search, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { computeValuation } from '@/lib/guidance-value/match';
import {
  formToSchedule,
  perSqftText,
  rateHeadline,
  rateLocation,
  rateSourceText,
  scheduleToForm,
  type ScheduleForm,
} from '@/lib/guidance-value/present';
import { sanitiseSchedule } from '@/lib/guidance-value/schedule-fields';
import {
  AREA_UNITS,
  SCHEDULE_KINDS,
  SCHEDULE_USAGES,
  type LookupResult,
} from '@/lib/guidance-value/types';
import { UNIT_LABELS, formatInr } from '@/lib/guidance-value/units';
import { cn } from '@/lib/utils';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none';
const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-300';

const AREA_KEYS = new Set<keyof ScheduleForm>([
  'land_value',
  'land_unit',
  'built_value',
  'built_unit',
]);

const FIELDS = [
  ['locality', 'Area / layout / block', 'e.g. Koramangala 6th Block'],
  ['road', 'Road / street', 'e.g. 18th Main'],
  ['village', 'Village', 'e.g. Bellandur'],
  ['survey_number', 'Survey no.', 'e.g. 45/2'],
  ['district', 'District', 'Bengaluru Urban'],
] as const;

function titleCase(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

export function PublicGuidanceValueTool() {
  const [form, setForm] = useState<ScheduleForm>(() =>
    scheduleToForm({ district: 'Bengaluru Urban' })
  );
  const [buildingRate, setBuildingRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const schedule = useMemo(
    () => sanitiseSchedule(formToSchedule(form)),
    [form]
  );
  const options = useMemo(
    () => ({ building_rate_per_sqft: Number(buildingRate) || null }),
    [buildingRate]
  );
  const selected =
    result?.matches.find((match) => match.rate.id === selectedId) ??
    result?.matches[0] ??
    null;
  const valuation = selected
    ? computeValuation(schedule, selected.rate, options)
    : null;

  const set = (key: keyof ScheduleForm) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (!AREA_KEYS.has(key)) {
      setResult(null);
      setSelectedId(null);
    }
  };

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schedule.locality && !schedule.village && !schedule.city) {
      setError('Enter the area, layout or village to search.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/public/guidance-value/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: formToSchedule(form), options }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Search failed (${res.status})`);
      }
      const data = body.data as LookupResult;
      setResult(data);
      setSelectedId(data.matches[0]?.rate.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search rates');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={search}
        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(([key, label, placeholder]) => (
            <div key={key}>
              <label className={LABEL_CLASS} htmlFor={`gv-${key}`}>
                {label}
              </label>
              <input
                id={`gv-${key}`}
                className={INPUT_CLASS}
                value={form[key]}
                placeholder={placeholder}
                onChange={(e) => set(key)(e.target.value)}
              />
            </div>
          ))}
          <div>
            <label className={LABEL_CLASS} htmlFor="gv-kind">
              Property type
            </label>
            <select
              id="gv-kind"
              className={INPUT_CLASS}
              value={form.kind}
              onChange={(e) => set('kind')(e.target.value)}
            >
              <option value="">Not stated</option>
              {SCHEDULE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {titleCase(kind)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="gv-usage">
              Usage
            </label>
            <select
              id="gv-usage"
              className={INPUT_CLASS}
              value={form.usage}
              onChange={(e) => set('usage')(e.target.value)}
            >
              <option value="">Not stated</option>
              {SCHEDULE_USAGES.map((usage) => (
                <option key={usage} value={usage}>
                  {titleCase(usage)}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ['land_value', 'land_unit', 'Land / site area'],
              ['built_value', 'built_unit', 'Built-up area'],
            ] as const
          ).map(([valueKey, unitKey, label]) => (
            <div key={valueKey}>
              <label className={LABEL_CLASS} htmlFor={`gv-${valueKey}`}>
                {label}
              </label>
              <div className="flex gap-2">
                <input
                  id={`gv-${valueKey}`}
                  className={INPUT_CLASS}
                  inputMode="decimal"
                  value={form[valueKey]}
                  placeholder="0"
                  onChange={(e) => set(valueKey)(e.target.value)}
                />
                <select
                  aria-label={`${label} unit`}
                  className={cn(INPUT_CLASS, 'w-28')}
                  value={form[unitKey]}
                  onChange={(e) => set(unitKey)(e.target.value)}
                >
                  {AREA_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {UNIT_LABELS[unit]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-xs font-semibold text-rose-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Searches the published Karnataka notifications. Confirm on Kaveri
            Online before paying stamp duty.
          </p>
          <Button
            type="submit"
            disabled={busy}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            {busy ? 'Searching…' : 'Find guidance value'}
          </Button>
        </div>
      </form>

      {result && result.coverage !== 'matched' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-400">
          {result.coverage === 'no_rates'
            ? 'Guidance values for this district have not been loaded yet. Check the area on Kaveri Online Services, or pick a district from the coverage list.'
            : 'No rate matched this area. Check the spelling of the area and road, or try the village name, then search again.'}
        </div>
      )}

      {result && result.matches.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2">
            <p className="text-xs font-black tracking-wider text-slate-500 uppercase">
              Matching rates
            </p>
            {result.matches.map((match) => {
              const active = match.rate.id === selected?.rate.id;
              return (
                <button
                  key={match.rate.id}
                  type="button"
                  onClick={() => setSelectedId(match.rate.id)}
                  className={cn(
                    'w-full cursor-pointer rounded-xl border p-4 text-left transition-colors',
                    active
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-white">
                      {rateLocation(match.rate)}
                    </p>
                    <span className="text-xs text-slate-500">
                      {Math.round(match.score * 100)}% match
                    </span>
                  </div>
                  <p className="text-sm text-slate-200">
                    {rateHeadline(match.rate)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {rateSourceText(match.rate)}
                  </p>
                  {match.reasons.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {match.reasons.join(' · ')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {selected && valuation && (
            <div className="h-fit space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-5">
              <p className="flex items-center gap-2 text-sm font-bold text-white">
                <Landmark className="size-4 text-emerald-400" />
                Guidance value
              </p>
              <p className="text-3xl font-black text-emerald-400">
                {valuation.total_value !== null
                  ? formatInr(valuation.total_value)
                  : '—'}
              </p>
              <p className="text-xs text-slate-400">
                {rateHeadline(selected.rate)} (
                {perSqftText(valuation.rate_per_sqft)})
              </p>
              {valuation.missing.includes('land_area') && (
                <p className="text-xs text-amber-400">
                  Enter the land / site area above to compute the value.
                </p>
              )}
              {valuation.missing.includes('built_up_area') && (
                <p className="text-xs text-amber-400">
                  Enter the built-up area above to compute the value.
                </p>
              )}
              {valuation.basis === 'land' && (
                <>
                  {valuation.land_value !== null && (
                    <p className="text-xs text-slate-300">
                      Land: {formatInr(valuation.land_value)}
                    </p>
                  )}
                  <div>
                    <label className={LABEL_CLASS} htmlFor="gv-building-rate">
                      Building rate, ₹ per sq.ft (optional)
                    </label>
                    <input
                      id="gv-building-rate"
                      className={INPUT_CLASS}
                      inputMode="decimal"
                      value={buildingRate}
                      placeholder="Construction rate from the notification"
                      onChange={(e) => setBuildingRate(e.target.value)}
                    />
                  </div>
                  {valuation.building_value !== null && (
                    <p className="text-xs text-slate-300">
                      Building: {formatInr(valuation.building_value)}
                    </p>
                  )}
                </>
              )}
              <p className="text-[11px] text-slate-500">
                An estimate from the published notification, not a valuation
                certificate.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
            <Upload className="size-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              Have the sale deed? Skip the typing.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Inside ConvoReal you upload the schedule page as a PDF or photo
              and the location, survey number and extent are read out and
              matched for you, then saved against the property or deal.
            </p>
          </div>
        </div>
        <a
          href="/signup"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
        >
          Start free <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
