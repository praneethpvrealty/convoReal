'use client';

import { useRef } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PriceHint } from '@/components/ui/price-hint';
import { formatCurrency } from '@/lib/currency-utils';
import {
  emptyFloorTenancy,
  type FloorTenancyDraft,
} from '@/lib/inventory/property-form-state';
import { storagePublicUrl } from '@/lib/storage/url';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface TenancySectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  uploadPlanImage: (file: File) => Promise<string | null>;
  canEdit: boolean;
  currency: string;
  floorRentTotal: number;
  floorAdvanceTotal: number;
}

export function TenancySection({
  values,
  set,
  uploadPlanImage,
  canEdit,
  currency,
  floorRentTotal,
  floorAdvanceTotal,
}: TenancySectionProps) {
  const { floorTenancies } = values;
  const tenancyPlanInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const updateFloorTenancy = (
    idx: number,
    key: keyof FloorTenancyDraft,
    value: string
  ) => {
    set('floorTenancies', (prev) =>
      prev.map((ft, i) => (i === idx ? { ...ft, [key]: value } : ft))
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">
            Floor-wise Tenancy (Rent Roll)
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-500">
            For pre-leased buildings — one row per lease, not per floor. A
            tenant taking several floors, or the whole building, is a single
            row: name every floor it covers in the label. Internal to your
            Engine; never shown on the showcase.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set('floorTenancies', (prev) => [...prev, { ...emptyFloorTenancy }])
          }
          className="h-8 shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <Plus className="mr-1 size-3.5" />
          Add Tenancy
        </Button>
      </div>

      {floorTenancies.map((ft, idx) => (
        <div
          key={idx}
          className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Tenancy {idx + 1}
            </span>
            <button
              type="button"
              onClick={() =>
                set('floorTenancies', (prev) =>
                  prev.filter((_, i) => i !== idx)
                )
              }
              className="text-slate-500 transition-colors hover:text-rose-400"
              aria-label={`Remove tenancy ${idx + 1}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">
                Floor(s) / Unit(s)
              </Label>
              <Input
                value={ft.floor}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'floor', e.target.value)
                }
                placeholder="e.g. G+1+2+3+4, or Entire building"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">Tenant Name</Label>
              <Input
                value={ft.tenant_name}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'tenant_name', e.target.value)
                }
                placeholder="e.g. Ramada Hospitality"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">
                Area (Sq.Ft.)
              </Label>
              <Input
                type="number"
                value={ft.area_sqft}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'area_sqft', e.target.value)
                }
                placeholder="10000"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">
                Monthly Rent (₹, excl. GST)
              </Label>
              <Input
                type="number"
                value={ft.monthly_rent}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'monthly_rent', e.target.value)
                }
                placeholder="1350000"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
              <PriceHint
                value={ft.monthly_rent}
                compact
                className="text-[10px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">
                Advance / Deposit (₹)
              </Label>
              <Input
                type="number"
                value={ft.advance}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'advance', e.target.value)
                }
                placeholder="e.g. 8100000"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
              <PriceHint value={ft.advance} compact className="text-[10px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">Lease Start</Label>
              <Input
                type="date"
                value={ft.lease_start}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'lease_start', e.target.value)
                }
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white [color-scheme:dark]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">Lease End</Label>
              <Input
                type="date"
                value={ft.lease_end}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'lease_end', e.target.value)
                }
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white [color-scheme:dark]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">
                Lock-in (months)
              </Label>
              <Input
                type="number"
                value={ft.lock_in_months}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'lock_in_months', e.target.value)
                }
                placeholder="36"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-400">Maintenance</Label>
              <Input
                value={ft.maintenance}
                onChange={(e) =>
                  updateFloorTenancy(idx, 'maintenance', e.target.value)
                }
                placeholder="e.g. ₹5/sqft, by tenant"
                className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-slate-400">Usage / Notes</Label>
            <Input
              value={ft.notes}
              onChange={(e) => updateFloorTenancy(idx, 'notes', e.target.value)}
              placeholder="e.g. 3-Star Hotel · 27 rooms · convention centre (400 seats)"
              className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-[11px] text-slate-400">
              Floor Plan
            </Label>
            {ft.floor_plan ? (
              <a
                href={storagePublicUrl(ft.floor_plan)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary truncate text-[11px] hover:underline"
              >
                View plan
              </a>
            ) : (
              <span className="text-[11px] text-slate-600">None attached</span>
            )}
            <input
              ref={(el) => {
                tenancyPlanInputs.current[idx] = el;
              }}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const path = await uploadPlanImage(file);
                if (path) updateFloorTenancy(idx, 'floor_plan', path);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canEdit}
              onClick={() => tenancyPlanInputs.current[idx]?.click()}
              className="ml-auto h-7 px-2 text-[11px] text-slate-400 hover:text-white"
            >
              <Upload className="mr-1 size-3" />
              {ft.floor_plan ? 'Replace' : 'Attach'}
            </Button>
            {ft.floor_plan && (
              <button
                type="button"
                onClick={() => updateFloorTenancy(idx, 'floor_plan', '')}
                className="text-slate-500 transition-colors hover:text-rose-400"
                aria-label={`Remove floor plan for tenancy ${idx + 1}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}

      {floorTenancies.length > 0 &&
        (floorRentTotal > 0 || floorAdvanceTotal > 0) && (
          <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
            {floorRentTotal > 0 && (
              <p className="flex items-baseline justify-between gap-3 text-xs font-semibold text-slate-300">
                <span>
                  Total monthly rent{' '}
                  <span className="font-medium text-slate-500">
                    ({floorTenancies.length} tenanc
                    {floorTenancies.length === 1 ? 'y' : 'ies'}, excluding GST)
                  </span>
                </span>
                <span className="text-primary">
                  {formatCurrency(floorRentTotal, currency)}
                </span>
              </p>
            )}
            {floorAdvanceTotal > 0 && (
              <p className="flex items-baseline justify-between gap-3 text-xs font-semibold text-slate-300">
                <span>
                  Total advance / deposit{' '}
                  <span className="font-medium text-slate-500">
                    held across all floors
                  </span>
                </span>
                <span className="text-primary">
                  {formatCurrency(floorAdvanceTotal, currency)}
                </span>
              </p>
            )}
            {floorRentTotal > 0 && floorAdvanceTotal > 0 && (
              <p className="border-t border-slate-800/80 pt-1 text-[11px] text-slate-500">
                Deposit is {(floorAdvanceTotal / floorRentTotal).toFixed(1)}×
                the monthly rent.
              </p>
            )}
          </div>
        )}
    </div>
  );
}
