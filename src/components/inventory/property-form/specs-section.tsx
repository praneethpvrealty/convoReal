'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AMENITIES_BY_CATEGORY,
  AREA_UNITS,
  FACING_DIRECTIONS,
  FLOORING_OPTIONS,
  FURNISHING_OPTIONS,
  LAND_CONVERSION_TYPES,
  LAND_LEGAL_STATUSES,
  LAND_OWNERSHIP_TYPES,
  NEARBY_HIGHLIGHTS_OPTIONS,
  POWER_BACKUP_OPTIONS,
} from '@/lib/inventory/property-options';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface SpecsSectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  hasBedsBaths: boolean;
  hasCommercialFields: boolean;
  isLand: boolean;
  isRawLand: boolean;
  isApartment: boolean;
  showFloorNumber: boolean;
  showTotalFloors: boolean;
  handleLandAreaChange: (val: string) => void;
  handleFrontageChange: (val: string) => void;
  handleDepthChange: (val: string) => void;
  media: ReactNode;
}

export function SpecsSection({
  values,
  set,
  hasBedsBaths,
  hasCommercialFields,
  isLand,
  isRawLand,
  isApartment,
  showFloorNumber,
  showTotalFloors,
  handleLandAreaChange,
  handleFrontageChange,
  handleDepthChange,
  media,
}: SpecsSectionProps) {
  const {
    listingType,
    bedrooms,
    bathrooms,
    areaSqft,
    areaUnit,
    landArea,
    landAreaUnit,
    superBuiltArea,
    frontage,
    depth,
    landZone,
    ownershipStatus,
    landUseZoning,
    legalStatus,
    conversionType,
    dealRemarks,
    dimensions,
    roadWidth,
    roadWidthUnit,
    facingDirection,
    khataEpid,
    khataForm,
    yearBuilt,
    furnishing,
    possessionDate,
    floorNumber,
    totalFloors,
    balconies,
    flooring,
    powerBackup,
    features,
    nearbyHighlights,
  } = values;
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleToggleFeature(feature: string) {
    set('features', (prev) =>
      prev.includes(feature)
        ? prev.filter((f) => f !== feature)
        : [...prev, feature]
    );
  }

  function handleToggleHighlight(highlight: string) {
    set('nearbyHighlights', (prev) =>
      prev.includes(highlight)
        ? prev.filter((h) => h !== highlight)
        : [...prev, highlight]
    );
  }

  const filteredAmenities = useMemo(() => {
    if (isLand) {
      return {
        'Land Specifications': [
          'Fenced Boundary',
          'Access Road',
          'Electricity Connection',
          'Water Supply (Borewell)',
          'Rain Water Harvesting',
          'CCTV Surveillance',
          '24/7 Security',
        ],
      };
    }
    if (hasCommercialFields) {
      return {
        'Commercial Specifications': [
          'Centrally Air Conditioned',
          'Conference Room',
          'Cafeteria/Food Court',
          'Wi-Fi Connectivity',
          'ATM',
          'Service/Goods Lift',
        ],
        'Utilities & Security': [
          '24/7 Security',
          'CCTV Surveillance',
          'Power Backup',
          'Fire Fighting System',
          'Lift/Elevator',
          'Reserved Parking',
          'Visitor Parking',
          'Waste Disposal',
        ],
      };
    }
    // Default Residential
    return {
      'Security & Utilities': AMENITIES_BY_CATEGORY['Security & Utilities'],
      'Leisure & Community': AMENITIES_BY_CATEGORY['Leisure & Community'],
    };
  }, [isLand, hasCommercialFields]);

  return (
    <div
      id="pf-specs"
      className="scroll-mt-2 space-y-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
    >
      <h4 className="text-sm font-semibold text-white">Area & Specs</h4>

      <div className="grid grid-cols-2 gap-4">
        {hasBedsBaths && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-bedrooms" className="text-slate-300">
              Beds
            </Label>
            <Input
              id="prop-bedrooms"
              type="number"
              value={bedrooms}
              onChange={(e) => set('bedrooms', e.target.value)}
              placeholder="e.g. 3"
              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        )}

        {hasBedsBaths && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-bathrooms" className="text-slate-300">
              Baths
            </Label>
            <Input
              id="prop-bathrooms"
              type="number"
              value={bathrooms}
              onChange={(e) => set('bathrooms', e.target.value)}
              placeholder="e.g. 2"
              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        )}

        {isLand ? (
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="prop-land-area" className="text-slate-300">
              Land Area <span className="text-red-400">*</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="prop-land-area"
                type="number"
                value={landArea}
                onChange={(e) => handleLandAreaChange(e.target.value)}
                placeholder="e.g. 2400"
                className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                required
              />
              <select
                value={landAreaUnit}
                onChange={(e) => set('landAreaUnit', e.target.value)}
                className="focus:ring-primary h-9 w-28 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-white focus:ring-2 focus:outline-none"
              >
                {AREA_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="prop-area" className="text-slate-300">
                Built-up Area
              </Label>
              <div className="flex gap-2">
                <Input
                  id="prop-area"
                  type="number"
                  value={areaSqft}
                  onChange={(e) => set('areaSqft', e.target.value)}
                  placeholder="e.g. 1500"
                  className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
                <select
                  value={areaUnit}
                  onChange={(e) => set('areaUnit', e.target.value)}
                  className="focus:ring-primary h-9 w-28 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-white focus:ring-2 focus:outline-none"
                >
                  {AREA_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={`space-y-1.5 ${isApartment ? 'col-span-2' : ''}`}>
              <Label htmlFor="prop-super-built" className="text-slate-300">
                Super Built-up Area ({areaUnit})
              </Label>
              <Input
                id="prop-super-built"
                type="number"
                value={superBuiltArea}
                onChange={(e) => set('superBuiltArea', e.target.value)}
                placeholder="e.g. 1800"
                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>

            {!isApartment && (
              <div className="space-y-1.5">
                <Label htmlFor="prop-land-area" className="text-slate-300">
                  Land Area
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="prop-land-area"
                    type="number"
                    value={landArea}
                    onChange={(e) => handleLandAreaChange(e.target.value)}
                    placeholder="e.g. 2400"
                    className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                  />
                  <select
                    value={landAreaUnit}
                    onChange={(e) => set('landAreaUnit', e.target.value)}
                    className="focus:ring-primary h-9 w-24 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs font-medium text-white focus:ring-2 focus:outline-none"
                  >
                    {AREA_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        {isLand ? (
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="prop-frontage" className="text-slate-300">
                Frontage (Ft)
              </Label>
              <Input
                id="prop-frontage"
                type="number"
                value={frontage}
                onChange={(e) => handleFrontageChange(e.target.value)}
                placeholder="e.g. 30"
                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prop-depth" className="text-slate-300">
                Depth (Ft)
              </Label>
              <Input
                id="prop-depth"
                type="number"
                value={depth}
                onChange={(e) => handleDepthChange(e.target.value)}
                placeholder="e.g. 40"
                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
          </div>
        ) : (
          !isApartment && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="prop-dimensions" className="text-slate-300">
                Dimensions
              </Label>
              <Input
                id="prop-dimensions"
                value={dimensions}
                onChange={(e) => set('dimensions', e.target.value)}
                placeholder="e.g. 30x40, 50x80 (Width x Length)"
                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
          )
        )}

        {!isApartment && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-road-width" className="text-slate-300">
              Road Width
            </Label>
            <div className="flex gap-2">
              <Input
                id="prop-road-width"
                type="number"
                value={roadWidth}
                onChange={(e) => set('roadWidth', e.target.value)}
                placeholder="e.g. 40"
                className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
              <select
                value={roadWidthUnit}
                onChange={(e) => set('roadWidthUnit', e.target.value)}
                className="focus:ring-primary h-9 w-24 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs font-medium text-white focus:ring-2 focus:outline-none"
              >
                <option value="Feet">Feet</option>
                <option value="Meters">Meters</option>
              </select>
            </div>
          </div>
        )}

        <div className={`space-y-1.5 ${isApartment ? 'col-span-2' : ''}`}>
          <Label htmlFor="prop-facing" className="text-slate-300">
            Facing Direction
          </Label>
          <select
            id="prop-facing"
            value={facingDirection}
            onChange={(e) => set('facingDirection', e.target.value)}
            className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
          >
            <option value="">Select Facing</option>
            {FACING_DIRECTIONS.map((dir) => (
              <option key={dir} value={dir}>
                {dir}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prop-khata-epid" className="text-slate-300">
            e-Khata ePID
          </Label>
          <Input
            id="prop-khata-epid"
            value={khataEpid}
            onChange={(e) => set('khataEpid', e.target.value)}
            placeholder="e.g. 7425317720"
            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prop-khata-form" className="text-slate-300">
            Khata
          </Label>
          <select
            id="prop-khata-form"
            value={khataForm}
            onChange={(e) => set('khataForm', e.target.value)}
            className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
          >
            <option value="">Not recorded</option>
            <option value="A">Form-A (A-Khata)</option>
            <option value="B">Form-B (B-Khata)</option>
          </select>
        </div>

        {!isLand && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-year-built" className="text-slate-300">
              Year Built
            </Label>
            <Input
              id="prop-year-built"
              type="number"
              min={1800}
              max={2100}
              value={yearBuilt}
              onChange={(e) => set('yearBuilt', e.target.value)}
              placeholder="e.g. 1998"
              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        )}

        {!isLand && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-furnishing" className="text-slate-300">
              Furnishing
            </Label>
            <select
              id="prop-furnishing"
              value={furnishing}
              onChange={(e) => set('furnishing', e.target.value)}
              className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
            >
              <option value="">Select Furnishing</option>
              {FURNISHING_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="prop-possession-date" className="text-slate-300">
            Possession Date
          </Label>
          <Input
            id="prop-possession-date"
            type="date"
            value={possessionDate}
            onChange={(e) => set('possessionDate', e.target.value)}
            className="h-9 border-slate-700 bg-slate-800 text-white [color-scheme:dark]"
          />
          <p className="text-[10px] text-slate-500">
            {isLand
              ? 'When possession transfers to the buyer. Leave empty if it is not committed yet.'
              : 'When the buyer gets the keys. Leave empty if it is not committed yet.'}
          </p>
        </div>

        {!isLand && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="prop-flooring" className="text-slate-300">
                Flooring
              </Label>
              <select
                id="prop-flooring"
                value={flooring}
                onChange={(e) => set('flooring', e.target.value)}
                className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
              >
                <option value="">Select Flooring</option>
                {FLOORING_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prop-power-backup" className="text-slate-300">
                Power Backup
              </Label>
              <select
                id="prop-power-backup"
                value={powerBackup}
                onChange={(e) => set('powerBackup', e.target.value)}
                className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
              >
                <option value="">Select Power Backup</option>
                {POWER_BACKUP_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {hasBedsBaths && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-balconies" className="text-slate-300">
              Balconies
            </Label>
            <Input
              id="prop-balconies"
              type="number"
              value={balconies}
              onChange={(e) => set('balconies', e.target.value)}
              placeholder="e.g. 2"
              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        )}

        {showFloorNumber && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-floor-number" className="text-slate-300">
              Floor No.
            </Label>
            <Input
              id="prop-floor-number"
              type="number"
              value={floorNumber}
              onChange={(e) => set('floorNumber', e.target.value)}
              placeholder="e.g. 4 (0 = Ground)"
              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        )}
        {showTotalFloors && (
          <div className="space-y-1.5">
            <Label htmlFor="prop-total-floors" className="text-slate-300">
              Total Floors
            </Label>
            <Input
              id="prop-total-floors"
              type="number"
              value={totalFloors}
              onChange={(e) => set('totalFloors', e.target.value)}
              placeholder="e.g. 12"
              className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
        )}

        {/* Land/JV Deal Notes — prefills the "Share via Email" draft */}
        {(isLand || listingType === 'JV/JD') && (
          <div className="col-span-2 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
            <div className="col-span-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Land / Deal Notes
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prop-ownership-status" className="text-slate-300">
                Ownership
              </Label>
              <select
                id="prop-ownership-status"
                value={ownershipStatus}
                onChange={(e) => set('ownershipStatus', e.target.value)}
                className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
              >
                <option value="">Select ownership</option>
                {LAND_OWNERSHIP_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                {/* Free text captured before this became a
                  picker stays selected rather than silently
                  resetting to blank on the next save. */}
                {ownershipStatus &&
                  !LAND_OWNERSHIP_TYPES.includes(ownershipStatus) && (
                    <option value={ownershipStatus}>{ownershipStatus}</option>
                  )}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prop-land-use-zoning" className="text-slate-300">
                Land Use Breakdown
              </Label>
              <Input
                id="prop-land-use-zoning"
                value={landUseZoning}
                onChange={(e) => set('landUseZoning', e.target.value)}
                placeholder="e.g. Residential zone 26A 13G, Red Zone 5A 29G"
                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
            {isRawLand && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="prop-legal-status" className="text-slate-300">
                    Legal Status
                  </Label>
                  <select
                    id="prop-legal-status"
                    value={legalStatus}
                    onChange={(e) => set('legalStatus', e.target.value)}
                    className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                  >
                    <option value="">Select legal status</option>
                    {LAND_LEGAL_STATUSES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="prop-conversion-type"
                    className="text-slate-300"
                  >
                    Conversion
                  </Label>
                  <select
                    id="prop-conversion-type"
                    value={conversionType}
                    onChange={(e) => set('conversionType', e.target.value)}
                    className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                  >
                    <option value="">Select conversion</option>
                    {LAND_CONVERSION_TYPES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Commercial/industrial land already gets this
                  control in the commercial block above. */}
                {!hasCommercialFields && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="prop-land-zone-res"
                      className="text-slate-300"
                    >
                      Land Use
                    </Label>
                    <select
                      id="prop-land-zone-res"
                      value={landZone}
                      onChange={(e) => set('landZone', e.target.value)}
                      className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
                    >
                      <option value="">Select land use</option>
                      <option value="Residential">Residential</option>
                      <option value="Commercial">Commercial</option>
                      <option value="Industrial">Industrial</option>
                      <option value="Agricultural">Agricultural</option>
                      <option value="Mixed Use">Mixed Use</option>
                      <option value="SEZ">SEZ (Special Economic Zone)</option>
                    </select>
                  </div>
                )}
              </>
            )}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="prop-deal-remarks" className="text-slate-300">
                Deal Remarks
              </Label>
              <Textarea
                id="prop-deal-remarks"
                value={dealRemarks}
                onChange={(e) => set('dealRemarks', e.target.value)}
                placeholder="e.g. Legal/aggregation status, road access, timeline for completion..."
                className="min-h-16 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
            <p className="col-span-2 text-[10px] text-slate-500">
              Internal notes — never shown on the public showcase. Used to
              prefill the &quot;Share via Email&quot; draft.
            </p>
          </div>
        )}

        {/* Amenities Checkbox Selection */}
        <div className="col-span-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
          <Label className="text-sm font-semibold text-slate-300">
            Amenities
          </Label>
          <div className="mt-1 space-y-4">
            {Object.entries(filteredAmenities).map(([category, items]) => (
              <div key={category} className="space-y-1.5">
                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  {category}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((amenity: string) => {
                    const isChecked = features.includes(amenity);
                    return (
                      <label
                        key={amenity}
                        className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleFeature(amenity)}
                          className="border-slate-750 text-primary focus:ring-primary size-3.5 rounded bg-slate-800 focus:ring-offset-slate-950"
                        />
                        <span>{amenity}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Collapsible Advanced section (landmarks) */}
        <div className="col-span-2 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-white"
          >
            {showAdvanced ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            <span>
              {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
            </span>
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/10 p-4">
              <Label className="text-xs font-semibold text-slate-300">
                Nearby Highlights / Landmarks
              </Label>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {NEARBY_HIGHLIGHTS_OPTIONS.map((highlight) => {
                  const isChecked = nearbyHighlights.includes(highlight);
                  return (
                    <label
                      key={highlight}
                      className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleHighlight(highlight)}
                        className="border-slate-750 text-primary focus:ring-primary size-3.5 rounded bg-slate-800 focus:ring-offset-slate-950"
                      />
                      <span>{highlight}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {media}
      </div>
    </div>
  );
}
