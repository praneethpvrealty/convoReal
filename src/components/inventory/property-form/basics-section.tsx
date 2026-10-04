'use client';

import type { Property } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PriceHint } from '@/components/ui/price-hint';
import {
  PROPERTY_STATUSES,
  propertyTypeGroupsFor,
} from '@/lib/inventory/property-options';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface BasicsSectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  isEdit: boolean;
  property?: Property | null;
}

export function BasicsSection({
  values,
  set,
  isEdit,
  property,
}: BasicsSectionProps) {
  const {
    title,
    price,
    soldPrice,
    sellerFinalPrice,
    sellerFinalPricePerSqft,
    listingType,
    rentPerMonth,
    maintenance,
    advance,
    gst,
    jvStructure,
    ownerSharePercent,
    builderSharePercent,
    goodwillAmount,
    btsLeaseYears,
    btsLockInYears,
    btsEscalationPercent,
    type,
    status,
  } = values;
  const propertyTypeGroups = propertyTypeGroupsFor(type);

  return (
    <div id="pf-basics" className="grid scroll-mt-2 grid-cols-2 gap-4">
      {isEdit && property?.property_code && (
        <div className="animate-fade-in col-span-2 space-y-1.5">
          <Label className="text-slate-400">Property Code (Unique ID)</Label>
          <Input
            value={property.property_code}
            readOnly
            className="bg-slate-850 cursor-not-allowed border-slate-800 font-mono text-slate-400 select-all"
          />
        </div>
      )}

      <div className="col-span-2 space-y-1.5">
        <Label htmlFor="prop-title" className="text-slate-300">
          Property Title <span className="text-red-400">*</span>
        </Label>
        <Input
          id="prop-title"
          value={title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. Luxurious 3BHK Apartment in Downtown"
          className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
          required
        />
      </div>

      <div className="animate-fade-in space-y-1.5">
        <Label htmlFor="prop-listing-type" className="text-slate-300">
          Listing Type
        </Label>
        <select
          id="prop-listing-type"
          value={listingType}
          onChange={(e) =>
            set(
              'listingType',
              e.target.value as 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit'
            )
          }
          className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
        >
          <option value="Sale">For Sale</option>
          <option value="Rent">For Rent</option>
          <option value="JV/JD">JV / Joint Development</option>
          <option value="Built to Suit">Built to Suit</option>
        </select>
      </div>

      {listingType === 'Sale' ? (
        <div className="animate-fade-in space-y-1.5">
          <Label htmlFor="prop-price" className="text-slate-300">
            Price (INR) <span className="text-red-400">*</span>
          </Label>
          <Input
            id="prop-price"
            type="number"
            value={price}
            onChange={(e) => set('price', e.target.value)}
            placeholder="e.g. 12000000"
            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            required
          />
          <PriceHint value={price} />
        </div>
      ) : listingType === 'Rent' ? (
        <div className="animate-fade-in col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="prop-rent" className="text-slate-300">
              Rent per month (INR) <span className="text-red-400">*</span>
            </Label>
            <Input
              id="prop-rent"
              type="number"
              value={rentPerMonth}
              onChange={(e) => set('rentPerMonth', e.target.value)}
              placeholder="e.g. 45000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              required
            />
            <PriceHint value={rentPerMonth} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-maintenance" className="text-slate-300">
              Maintenance (INR)
            </Label>
            <Input
              id="prop-maintenance"
              type="number"
              value={maintenance}
              onChange={(e) => set('maintenance', e.target.value)}
              placeholder="e.g. 5000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={maintenance} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-advance" className="text-slate-300">
              Advance (Deposit) (INR)
            </Label>
            <Input
              id="prop-advance"
              type="number"
              value={advance}
              onChange={(e) => set('advance', e.target.value)}
              placeholder="e.g. 200000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={advance} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-gst" className="text-slate-300">
              GST (INR)
            </Label>
            <Input
              id="prop-gst"
              type="number"
              value={gst}
              onChange={(e) => set('gst', e.target.value)}
              placeholder="e.g. 1800"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={gst} />
          </div>
        </div>
      ) : listingType === 'Built to Suit' ? (
        <div className="animate-fade-in col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-rent" className="text-slate-300">
              Expected Rent per month (INR){' '}
              <span className="text-red-400">*</span>
            </Label>
            <Input
              id="prop-bts-rent"
              type="number"
              value={rentPerMonth}
              onChange={(e) => set('rentPerMonth', e.target.value)}
              placeholder="e.g. 250000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              required
            />
            <PriceHint value={rentPerMonth} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-maintenance" className="text-slate-300">
              Maintenance / CAM (INR)
            </Label>
            <Input
              id="prop-bts-maintenance"
              type="number"
              value={maintenance}
              onChange={(e) => set('maintenance', e.target.value)}
              placeholder="e.g. 15000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={maintenance} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-advance" className="text-slate-300">
              Security Deposit (INR)
            </Label>
            <Input
              id="prop-bts-advance"
              type="number"
              value={advance}
              onChange={(e) => set('advance', e.target.value)}
              placeholder="e.g. 1500000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={advance} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-gst" className="text-slate-300">
              GST (INR)
            </Label>
            <Input
              id="prop-bts-gst"
              type="number"
              value={gst}
              onChange={(e) => set('gst', e.target.value)}
              placeholder="e.g. 45000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={gst} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-lease-years" className="text-slate-300">
              Total Lease Term (years) <span className="text-red-400">*</span>
            </Label>
            <Input
              id="prop-bts-lease-years"
              type="number"
              value={btsLeaseYears}
              onChange={(e) => set('btsLeaseYears', e.target.value)}
              placeholder="e.g. 9"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-lockin-years" className="text-slate-300">
              Lock-in Period (years)
            </Label>
            <Input
              id="prop-bts-lockin-years"
              type="number"
              value={btsLockInYears}
              onChange={(e) => set('btsLockInYears', e.target.value)}
              placeholder="e.g. 3"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-bts-escalation" className="text-slate-300">
              Rent Escalation (%)
            </Label>
            <Input
              id="prop-bts-escalation"
              type="number"
              value={btsEscalationPercent}
              onChange={(e) => set('btsEscalationPercent', e.target.value)}
              placeholder="e.g. 5"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        </div>
      ) : (
        <div className="animate-fade-in col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="prop-jv-structure" className="text-slate-300">
              Deal Structure
            </Label>
            <select
              id="prop-jv-structure"
              value={jvStructure}
              onChange={(e) =>
                set(
                  'jvStructure',
                  e.target.value as 'Revenue Share' | 'Area Share' | 'Hybrid'
                )
              }
              className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
            >
              <option value="Revenue Share">Revenue Share</option>
              <option value="Area Share">Area Share</option>
              <option value="Hybrid">Hybrid</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-jv-price" className="text-slate-300">
              Expected Project Value (INR)
            </Label>
            <Input
              id="prop-jv-price"
              type="number"
              value={price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="e.g. 50000000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={price} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-jv-owner-share" className="text-slate-300">
              Owner Share (%) <span className="text-red-400">*</span>
            </Label>
            <Input
              id="prop-jv-owner-share"
              type="number"
              value={ownerSharePercent}
              onChange={(e) => {
                const val = e.target.value;
                set('ownerSharePercent', val);
                const num = Number(val);
                if (
                  val.trim() !== '' &&
                  !isNaN(num) &&
                  num >= 0 &&
                  num <= 100
                ) {
                  set('builderSharePercent', String(100 - num));
                }
              }}
              placeholder="e.g. 40"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-jv-builder-share" className="text-slate-300">
              Builder Share (%) <span className="text-red-400">*</span>
            </Label>
            <Input
              id="prop-jv-builder-share"
              type="number"
              value={builderSharePercent}
              onChange={(e) => {
                const val = e.target.value;
                set('builderSharePercent', val);
                const num = Number(val);
                if (
                  val.trim() !== '' &&
                  !isNaN(num) &&
                  num >= 0 &&
                  num <= 100
                ) {
                  set('ownerSharePercent', String(100 - num));
                }
              }}
              placeholder="e.g. 60"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-jv-goodwill" className="text-slate-300">
              Goodwill (INR)
            </Label>
            <Input
              id="prop-jv-goodwill"
              type="number"
              value={goodwillAmount}
              onChange={(e) => set('goodwillAmount', e.target.value)}
              placeholder="e.g. 2000000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={goodwillAmount} />
            <p className="text-[10px] text-slate-500">
              Non-refundable upfront payment to the landowner.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prop-jv-advance" className="text-slate-300">
              Advance (Refundable) (INR)
            </Label>
            <Input
              id="prop-jv-advance"
              type="number"
              value={advance}
              onChange={(e) => set('advance', e.target.value)}
              placeholder="e.g. 1000000"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <PriceHint value={advance} />
            <p className="text-[10px] text-slate-500">
              Refundable deposit, adjusted against the owner&apos;s share at
              handover.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="prop-type" className="text-slate-300">
          Property Type
        </Label>
        <select
          id="prop-type"
          value={type}
          onChange={(e) => set('type', e.target.value)}
          className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
        >
          {propertyTypeGroups.map((g) => (
            <optgroup key={g.group} label={`ALL ${g.group.toUpperCase()}`}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label ?? o.value}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {isEdit && (
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="prop-status" className="text-slate-300">
            Status
          </Label>
          <select
            id="prop-status"
            value={status}
            onChange={(e) => set('status', e.target.value)}
            className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
          >
            {PROPERTY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {isEdit && (
        <div className="col-span-2 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
          <h4 className="text-sm font-semibold text-white">
            Seller&apos;s final price
          </h4>
          <p className="text-[11px] text-slate-500">
            What the seller will actually accept, as against the quoted price
            above. Internal — never shown on the showcase or in a share link.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <Label
                htmlFor="prop-seller-final-price"
                className="text-slate-300"
              >
                Total
              </Label>
              <Input
                id="prop-seller-final-price"
                type="number"
                min="0"
                value={sellerFinalPrice}
                onChange={(e) => set('sellerFinalPrice', e.target.value)}
                placeholder={price ? `e.g. ${price}` : 'e.g. 42000000'}
                className="border-slate-700 bg-slate-800 text-white"
              />
              <PriceHint value={sellerFinalPrice} />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="prop-seller-final-rate"
                className="text-slate-300"
              >
                Per Sq.Ft.
              </Label>
              <Input
                id="prop-seller-final-rate"
                type="number"
                min="0"
                value={sellerFinalPricePerSqft}
                onChange={(e) => set('sellerFinalPricePerSqft', e.target.value)}
                placeholder="e.g. 10500"
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
          </div>
        </div>
      )}

      {isEdit && status === 'Sold' && (
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="prop-sold-price" className="text-slate-300">
            Final sale price
          </Label>
          <Input
            id="prop-sold-price"
            type="number"
            min="0"
            value={soldPrice}
            onChange={(e) => set('soldPrice', e.target.value)}
            placeholder={price ? `e.g. ${price}` : 'e.g. 8500000'}
            className="border-slate-700 bg-slate-800 text-white"
          />
          <PriceHint value={soldPrice} />
          <p className="text-[11px] text-slate-500">
            Optional — improves your area&apos;s price accuracy. Never shown to
            buyers.
          </p>
        </div>
      )}
    </div>
  );
}
