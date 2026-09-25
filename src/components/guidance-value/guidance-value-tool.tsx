'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  FileSearch,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { computeValuation } from '@/lib/guidance-value/match';
import {
  formToSchedule,
  perSqftText,
  rateHeadline,
  rateLocation,
  rateSourceText,
  scheduleHeadline,
  schedulePrinted,
  scheduleToForm,
  type ScheduleForm,
} from '@/lib/guidance-value/present';
import { sanitiseSchedule } from '@/lib/guidance-value/schedule-fields';
import {
  AREA_UNITS,
  SCHEDULE_KINDS,
  SCHEDULE_USAGES,
  type LookupResult,
  type PropertySchedule,
} from '@/lib/guidance-value/types';
import { UNIT_LABELS, formatInr } from '@/lib/guidance-value/units';
import { cn } from '@/lib/utils';

interface GuidanceValueToolProps {
  creditCost?: number | null;
  propertyId?: string | null;
  dealId?: string | null;
  canSave?: boolean;
  onSaved?: () => void;
}

const FIELD_CLASS =
  'border-input bg-background h-9 w-full rounded-md border px-2 text-sm';

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `Request failed (${res.status})`;
}

export function GuidanceValueTool({
  creditCost,
  propertyId,
  dealId,
  canSave = false,
  onSaved,
}: GuidanceValueToolProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'read' | 'match' | 'save' | null>(null);
  const [baseSchedule, setBaseSchedule] = useState<PropertySchedule | null>(
    null
  );
  const [form, setForm] = useState<ScheduleForm | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildingRate, setBuildingRate] = useState('');

  const schedule = useMemo(
    () =>
      form ? sanitiseSchedule(formToSchedule(form, baseSchedule ?? {})) : null,
    [form, baseSchedule]
  );
  const options = useMemo(
    () => ({ building_rate_per_sqft: Number(buildingRate) || null }),
    [buildingRate]
  );
  const selected =
    result?.matches.find((m) => m.rate.id === selectedId) ??
    result?.matches[0] ??
    null;
  const valuation =
    selected && schedule
      ? computeValuation(schedule, selected.rate, options)
      : null;

  const applyResult = (data: LookupResult) => {
    setResult(data);
    setSelectedId(data.matches[0]?.rate.id ?? null);
  };

  const readFile = async (file: File) => {
    setBusy('read');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/guidance-value/lookup', {
        method: 'POST',
        body,
      });
      if (!res.ok) throw new Error(await readError(res));
      const { data } = (await res.json()) as { data: LookupResult };
      setBaseSchedule(data.schedule);
      setForm(scheduleToForm(data.schedule));
      applyResult(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not read the schedule'
      );
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const rematch = async () => {
    if (!form) return;
    setBusy('match');
    try {
      const res = await fetch('/api/guidance-value/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: formToSchedule(form, baseSchedule ?? {}),
          options,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { data } = (await res.json()) as { data: LookupResult };
      applyResult(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not search rates'
      );
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!form || !selected) return;
    setBusy('save');
    try {
      const res = await fetch('/api/guidance-value/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId ?? undefined,
          deal_id: dealId ?? undefined,
          rate_id: selected.rate.id,
          schedule: formToSchedule(form, baseSchedule ?? {}),
          options,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success('Guidance value saved');
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const set = (key: keyof ScheduleForm) => (value: string) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dashed p-5">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              Upload the sale deed schedule or RTC
            </p>
            <p className="text-muted-foreground text-xs">
              A PDF or photo of the schedule page or RTC (under 4 MB). Karnataka
              only.
              {creditCost ? ` Reading it costs ${creditCost} credits.` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setBaseSchedule({});
                setForm(scheduleToForm({ district: 'Bengaluru Urban' }));
                setResult(null);
              }}
            >
              Enter manually
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {busy === 'read' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              {busy === 'read' ? 'Reading…' : 'Upload schedule'}
            </Button>
          </div>
        </div>
      </div>

      {form && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="h-4 w-4" />
              {schedule ? scheduleHeadline(schedule) : 'Property schedule'}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={rematch}
            >
              {busy === 'match' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Search rates
            </Button>
          </div>
          {baseSchedule?.summary && (
            <p className="text-muted-foreground text-xs">
              {baseSchedule.summary}
            </p>
          )}
          {baseSchedule && schedulePrinted(baseSchedule) && (
            <p className="text-muted-foreground text-xs">
              {schedulePrinted(baseSchedule)}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                ['locality', 'Area / layout / block'],
                ['road', 'Road / street'],
                ['village', 'Village'],
                ['hobli', 'Hobli'],
                ['taluk', 'Taluk'],
                ['district', 'District'],
                ['survey_number', 'Survey no.'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  value={form[key]}
                  onChange={(e) => set(key)(e.target.value)}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Property type</Label>
              <select
                className={FIELD_CLASS}
                value={form.kind}
                onChange={(e) => set('kind')(e.target.value)}
              >
                <option value="">Not stated</option>
                {SCHEDULE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind[0].toUpperCase() + kind.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Usage</Label>
              <select
                className={FIELD_CLASS}
                value={form.usage}
                onChange={(e) => set('usage')(e.target.value)}
              >
                <option value="">Not stated</option>
                {SCHEDULE_USAGES.map((usage) => (
                  <option key={usage} value={usage}>
                    {usage[0].toUpperCase() + usage.slice(1)}
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
              <div key={valueKey} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <div className="flex gap-2">
                  <Input
                    inputMode="decimal"
                    value={form[valueKey]}
                    onChange={(e) => set(valueKey)(e.target.value)}
                  />
                  <select
                    className={cn(FIELD_CLASS, 'w-28')}
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
        </div>
      )}

      {result && result.coverage !== 'matched' && (
        <div className="text-muted-foreground rounded-xl border p-4 text-sm">
          {result.coverage === 'no_rates'
            ? 'Guidance values for this district have not been loaded yet. Check the area on Kaveri Online, or ask your ConvoReal admin to import the notification.'
            : 'No rate matched this area. Check the spelling of the area and road, or try the village name, then search again.'}
        </div>
      )}

      {result && result.matches.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-semibold uppercase">
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
                    'w-full rounded-xl border p-3 text-left transition-colors',
                    active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {rateLocation(match.rate)}
                    </p>
                    <span className="text-muted-foreground text-xs">
                      {Math.round(match.score * 100)}% match
                    </span>
                  </div>
                  <p className="text-sm">{rateHeadline(match.rate)}</p>
                  <p className="text-muted-foreground text-xs">
                    {rateSourceText(match.rate)}
                  </p>
                  {match.reasons.length > 0 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {match.reasons.join(' · ')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {selected && valuation && (
            <div className="bg-muted/30 h-fit space-y-3 rounded-xl border p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <FileSearch className="h-4 w-4" />
                Guidance value
              </p>
              <p className="text-2xl font-black">
                {valuation.total_value !== null
                  ? formatInr(valuation.total_value)
                  : '—'}
              </p>
              <p className="text-muted-foreground text-xs">
                {rateHeadline(selected.rate)} (
                {perSqftText(valuation.rate_per_sqft)})
              </p>
              {valuation.missing.includes('land_area') && (
                <p className="text-xs text-amber-600">
                  The schedule does not state the land / site area. Enter it
                  above to compute the value.
                </p>
              )}
              {valuation.missing.includes('built_up_area') && (
                <p className="text-xs text-amber-600">
                  Enter the built-up area above to compute the value.
                </p>
              )}
              {valuation.basis === 'land' && (
                <>
                  {valuation.land_value !== null && (
                    <p className="text-xs">
                      Land: {formatInr(valuation.land_value)}
                    </p>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Building rate, ₹ per sq.ft (optional)
                    </Label>
                    <Input
                      inputMode="decimal"
                      value={buildingRate}
                      onChange={(e) => setBuildingRate(e.target.value)}
                      placeholder="Construction rate from the notification"
                    />
                  </div>
                  {valuation.building_value !== null && (
                    <p className="text-xs">
                      Building: {formatInr(valuation.building_value)}
                    </p>
                  )}
                </>
              )}
              <p className="text-muted-foreground text-[11px]">
                An estimate from the published notification. Confirm on Kaveri
                Online before paying stamp duty.
              </p>
              {canSave && (propertyId || dealId) && (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={busy !== null || valuation.total_value === null}
                  onClick={save}
                >
                  {busy === 'save' ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-4 w-4" />
                  )}
                  Save to {dealId ? 'transaction' : 'property'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
