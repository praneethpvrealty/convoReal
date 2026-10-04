'use client';

import type { RefObject } from 'react';
import { AlertTriangle, Loader2, Plus, Tag, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PriceHint } from '@/components/ui/price-hint';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { yieldApplies } from '@/lib/inventory/rental-yield';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface LocationSectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  autocompleteRef: RefObject<HTMLDivElement | null>;
  ensureLocalitiesLoaded: () => Promise<void>;
  handleSearchQueryChange: (val: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  searchingProjects: boolean;
  filteredProjects: AutoCompleteProject[];
  filteredSublocalities: string[];
  googleSuggestions: GooglePlaceSuggestion[];
  handleGooglePick: (s: GooglePlaceSuggestion) => Promise<void>;
  isProjectMatched: boolean;
  mapPinDrift: number | null;
  guardedByType: boolean;
  locationGuarded: boolean;
  tagInput: string;
  setTagInput: (value: string) => void;
  tagSuggestions: { tag: string; uses: number }[];
  hasCommercialFields: boolean;
  hasCommercialBuildingFields: boolean;
  roiValue: number | null;
}

export interface AutoCompleteProject {
  name: string;
  sublocality: string;
  city: string;
  state: string;
  address: string;
  source?: 'rera' | 'curated' | 'ai' | null;
}

export interface GooglePlaceSuggestion {
  place_id: string;
  main_text: string;
  secondary_text: string;
}

export function LocationSection({
  values,
  set,
  autocompleteRef,
  ensureLocalitiesLoaded,
  handleSearchQueryChange,
  showSuggestions,
  setShowSuggestions,
  searchingProjects,
  filteredProjects,
  filteredSublocalities,
  googleSuggestions,
  handleGooglePick,
  isProjectMatched,
  mapPinDrift,
  guardedByType,
  locationGuarded,
  tagInput,
  setTagInput,
  tagSuggestions,
  hasCommercialFields,
  hasCommercialBuildingFields,
  roiValue,
}: LocationSectionProps) {
  const {
    listingType,
    city,
    stateVal,
    address,
    geoPick,
    landZone,
    idealFor,
    googleMapLink,
    showcaseVisibility,
    notes,
    tags,
    rentalIncome,
    searchQuery,
  } = values;

  return (
    <div
      id="pf-location"
      className="scroll-mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
    >
      <h4 className="text-sm font-semibold text-white">Property Location</h4>

      <div className="relative space-y-1.5" ref={autocompleteRef}>
        <Label htmlFor="prop-search-query" className="text-slate-300">
          Project Name or Area / Sublocality{' '}
          <span className="text-red-400">*</span>
        </Label>
        <Input
          id="prop-search-query"
          value={searchQuery}
          onChange={(e) => {
            ensureLocalitiesLoaded();
            handleSearchQueryChange(e.target.value);
          }}
          onFocus={() => {
            ensureLocalitiesLoaded();
            setShowSuggestions(true);
          }}
          placeholder="Search project (e.g. Prestige) or area (e.g. Indiranagar)..."
          className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
          required
        />

        {showSuggestions && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-800 text-slate-200 shadow-xl">
            {searchingProjects ? (
              <div className="flex items-center justify-center gap-2 p-3 text-center text-xs text-slate-500">
                <Loader2 className="text-primary size-3 animate-spin" />
                <span>Searching project registry...</span>
              </div>
            ) : filteredProjects.length === 0 &&
              filteredSublocalities.length === 0 &&
              googleSuggestions.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500">
                No matching projects or areas. Keep typing to enter a custom
                value.
              </div>
            ) : (
              <div>
                {filteredProjects.length > 0 && (
                  <div className="p-1">
                    <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                      🏢 Projects
                    </div>
                    {filteredProjects.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => {
                          set('project', p.name);
                          set('sublocality', p.sublocality);
                          set('city', p.city);
                          set('stateVal', p.state);
                          set('address', p.address);
                          set('searchQuery', p.name);
                          set('geoPick', null); // registry pick has no coords; server geocodes on save
                          setShowSuggestions(false);
                        }}
                        className="w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                      >
                        <span className="font-bold">{p.name}</span>
                        <span className="text-slate-400">
                          {' '}
                          - {p.sublocality}, {p.city}
                        </span>
                        {'source' in p && p.source === 'ai' && (
                          <span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[10px] text-amber-300">
                            AI suggestion · unverified
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {filteredSublocalities.length > 0 && (
                  <div className="border-t border-slate-700 p-1">
                    <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                      📍 Areas / Sublocalities
                    </div>
                    {filteredSublocalities.map((sub) => (
                      <button
                        key={sub}
                        type="button"
                        onClick={() => {
                          set('project', '');
                          const parts = sub.split(',').map((s) => s.trim());
                          if (parts.length > 1) {
                            set('sublocality', parts[0]);
                            set('address', parts[1]);
                          } else {
                            set('sublocality', sub);
                            set('address', '');
                          }
                          set('city', 'Bangalore');
                          set('stateVal', 'Karnataka');
                          set('searchQuery', sub);
                          set('geoPick', null); // registry pick has no coords; server geocodes on save
                          setShowSuggestions(false);
                        }}
                        className="w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                      >
                        <span className="font-medium text-slate-200">
                          {sub}
                        </span>
                        <span className="text-slate-400">
                          {' '}
                          - Bangalore, Karnataka
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {googleSuggestions.length > 0 && (
                  <div className="border-t border-slate-700 p-1">
                    <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                      🌐 Google Maps
                    </div>
                    {googleSuggestions.map((s) => (
                      <button
                        key={s.place_id}
                        type="button"
                        onClick={() => handleGooglePick(s)}
                        className="w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
                      >
                        <span className="font-medium text-slate-200">
                          {s.main_text}
                        </span>
                        {s.secondary_text && (
                          <span className="text-slate-400">
                            {' '}
                            - {s.secondary_text}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {geoPick && (
          <p className="mt-0.5 text-[10px] font-medium text-sky-400">
            📍 Pinned to Google Maps locality &quot;
            {geoPick.canonical}&quot; — enables radius search.
          </p>
        )}

        {isProjectMatched && (
          <p className="mt-0.5 text-[10px] font-medium text-green-400">
            Linked to project location details (pre-filled fields locked).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="prop-city" className="text-slate-300">
            City <span className="text-red-400">*</span>
          </Label>
          <Input
            id="prop-city"
            value={city}
            onChange={(e) => set('city', e.target.value)}
            placeholder="e.g. Bangalore"
            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            required
            disabled={isProjectMatched}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prop-state" className="text-slate-300">
            State <span className="text-red-400">*</span>
          </Label>
          <Input
            id="prop-state"
            value={stateVal}
            onChange={(e) => set('stateVal', e.target.value)}
            placeholder="e.g. Karnataka"
            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            required
            disabled={isProjectMatched}
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="prop-address" className="text-slate-300">
            Landmark / Street Address
          </Label>
          <Input
            id="prop-address"
            value={address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="e.g. Near Metro Station"
            className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isProjectMatched}
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="prop-google-map-link" className="text-slate-300">
            Google Map Link (Shared on inquiry approval only)
          </Label>
          <Input
            id="prop-google-map-link"
            value={googleMapLink}
            onChange={(e) => set('googleMapLink', e.target.value)}
            placeholder="e.g. https://maps.google.com/?q=..."
          />
          {mapPinDrift !== null && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                This pin sits {mapPinDrift.toFixed(1)} km from the selected
                locality
                {geoPick?.canonical ? ` (${geoPick.canonical})` : ''}. The pin
                wins on save — fix the link or re-pick the locality if
                that&apos;s the wrong one.
              </span>
            </p>
          )}
        </div>

        <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <div className="space-y-0.5">
            <Label
              htmlFor="prop-location-guard"
              className="cursor-pointer text-sm text-slate-300"
            >
              Guard exact location
            </Label>
            <p className="text-xs leading-normal text-slate-400">
              {guardedByType
                ? 'On by default for this property type — buyers and co-brokers see locality only until you approve a reveal.'
                : 'Off by default for this property type — turn on to hide the street address, map pin and coordinates until you approve a reveal.'}
            </p>
          </div>
          <Switch
            id="prop-location-guard"
            checked={locationGuarded}
            onCheckedChange={(checked) => {
              const next = checked ? 'locality' : 'exact';
              set(
                'locationPrivacy',
                (guardedByType ? 'locality' : 'exact') === next ? '' : next
              );
            }}
          />
        </div>

        <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <div className="space-y-0.5">
            <Label
              htmlFor="prop-showcase-gate"
              className="cursor-pointer text-sm text-slate-300"
            >
              Confidential listing
            </Label>
            <p className="text-xs leading-normal text-slate-400">
              Anyone opening the public link sees only the type, locality and a
              price band until you approve them. Link previews and search
              engines get nothing, and photos you release are watermarked to the
              viewer.
            </p>
          </div>
          <Switch
            id="prop-showcase-gate"
            checked={showcaseVisibility === 'teaser'}
            onCheckedChange={(checked) =>
              set('showcaseVisibility', checked ? 'teaser' : '')
            }
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label
            htmlFor="prop-notes"
            className="flex items-center gap-1.5 text-slate-300"
          >
            Internal Notes
            <span className="rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              Engine Only — Not visible to clients
            </span>
          </Label>
          <Textarea
            id="prop-notes"
            value={notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="e.g. Near Garuda Mall, 3rd left from Metro Station. Owner available only on weekdays..."
            className="min-h-[80px] resize-y border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
            rows={3}
          />
          <p className="text-xs leading-normal text-slate-400">
            Location landmarks, access info, owner contact preferences —
            searchable in the Engine but private to your team.
          </p>
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label
            htmlFor="prop-tags"
            className="flex items-center gap-1.5 text-slate-300"
          >
            Tags
            <span className="rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              Engine Only — Not visible to clients
            </span>
          </Label>
          <div className="focus-within:ring-primary flex flex-wrap items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-slate-950">
            {tags.map((tag, idx) => (
              <span
                key={`${tag}-${idx}`}
                className="bg-primary/15 border-primary/25 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              >
                <Tag className="size-2.5" />
                {tag}
                <button
                  type="button"
                  onClick={() =>
                    set(
                      'tags',
                      tags.filter((_, i) => i !== idx)
                    )
                  }
                  className="text-primary/70 hover:text-primary"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="prop-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  const next = tagInput.trim();
                  if (
                    next &&
                    !tags.some((t) => t.toLowerCase() === next.toLowerCase())
                  ) {
                    set('tags', [...tags, next]);
                  }
                  setTagInput('');
                } else if (
                  e.key === 'Backspace' &&
                  !tagInput &&
                  tags.length > 0
                ) {
                  set('tags', tags.slice(0, -1));
                }
              }}
              onBlur={() => {
                const next = tagInput.trim();
                if (
                  next &&
                  !tags.some((t) => t.toLowerCase() === next.toLowerCase())
                ) {
                  set('tags', [...tags, next]);
                }
                setTagInput('');
              }}
              placeholder={
                tags.length === 0
                  ? 'e.g. Brick and Bolt, Distress Sale — press Enter to add'
                  : 'Add tag...'
              }
              className="h-6 min-w-[140px] flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          {tagSuggestions.filter(
            (s) => !tags.some((t) => t.toLowerCase() === s.tag.toLowerCase())
          ).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Already in use in this account. A tag only earns its
                keep if every listing it should cover spells it the
                same way — "APM" on three villas of a project and
                "AMP" on the fourth leaves the fourth out of the
                search the tag exists for. */}
              {tagSuggestions
                .filter(
                  (s) =>
                    !tags.some((t) => t.toLowerCase() === s.tag.toLowerCase())
                )
                .slice(0, 10)
                .map((s) => (
                  <button
                    key={s.tag}
                    type="button"
                    onClick={() => set('tags', [...tags, s.tag])}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-200"
                  >
                    <Plus className="size-2.5" />
                    {s.tag}
                    <span className="text-slate-600">{s.uses}</span>
                  </button>
                ))}
            </div>
          )}
          <p className="text-xs leading-normal text-slate-400">
            Builder names, campaigns, deal nicknames — typing any part of a tag
            finds this property in Inventory search and property pickers.
          </p>
        </div>

        {/* Commercial Location Fields */}
        {hasCommercialFields && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="prop-land-zone" className="text-slate-300">
                Land Zone
              </Label>
              <select
                id="prop-land-zone"
                value={landZone}
                onChange={(e) => set('landZone', e.target.value)}
                className="focus:ring-primary flex h-9 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-medium text-white focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
              >
                <option value="">Select Land Zone</option>
                <option value="Industrial">Industrial</option>
                <option value="Commercial">Commercial</option>
                <option value="Residential">Residential</option>
                <option value="Agricultural">Agricultural</option>
                <option value="Mixed Use">Mixed Use</option>
                <option value="SEZ">SEZ (Special Economic Zone)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prop-ideal-for" className="text-slate-300">
                Ideal For Businesses
              </Label>
              <Input
                id="prop-ideal-for"
                value={idealFor}
                onChange={(e) => set('idealFor', e.target.value)}
                placeholder="e.g. Software, Bank, Clinic"
                className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>

            {hasCommercialBuildingFields && (
              <div className="space-y-1.5">
                <Label htmlFor="prop-rental-income" className="text-slate-300">
                  Monthly Rental Income (INR)
                </Label>
                <Input
                  id="prop-rental-income"
                  type="number"
                  value={rentalIncome}
                  onChange={(e) => set('rentalIncome', e.target.value)}
                  placeholder="e.g. 250000"
                  className="h-9 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
                <PriceHint value={rentalIncome} />
              </div>
            )}

            {hasCommercialBuildingFields && yieldApplies(listingType) && (
              <div className="space-y-1.5">
                <Label htmlFor="prop-roi" className="text-slate-300">
                  ROI (Return on Investment)
                </Label>
                <Input
                  id="prop-roi"
                  type="text"
                  value={
                    roiValue !== null
                      ? `${roiValue}%`
                      : 'calculated automatically'
                  }
                  readOnly
                  className="bg-slate-850 text-primary h-9 cursor-not-allowed border-slate-800 font-medium"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
