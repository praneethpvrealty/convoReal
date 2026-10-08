'use client';

import { useId, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Play,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Property } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
import {
  DEAL_FLOOR_BUDGETS,
  dealFloorLocality,
  dealFloorPriceLabel,
  MATCH_REPORT_SHORTLIST,
  type DealFloorKindCount,
} from '@/lib/showcase/deal-floor';

interface DealFloorHeroProps {
  siteName: string;
  fontClassName?: string;
  total: number;
  kinds: DealFloorKindCount[];
  selectedType: string;
  onTypeChange: (value: string) => void;
  locations: string[];
  selectedLocation: string | null;
  onLocationChange: (value: string | null) => void;
  nearbyLabel: string | null;
  onSearchNearRequest: () => void;
  onSearchNear: (query: string, placeLabel?: string) => Promise<boolean>;
  nearbyPending: boolean;
  nearbyError: string | null;
  maxBudget: number | null;
  onBudgetChange: (value: number | null) => void;
  matchCount: number;
  onSeeMatches: () => void;
  onPlay: () => void;
}

const ANY = '__any__';
const NEARBY_SUGGESTIONS = 3;

function Blank({
  label,
  value,
  options,
  onChange,
  fontClassName,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  fontClassName?: string;
}) {
  return (
    <Select
      value={value || ANY}
      onValueChange={(next) => onChange(next === ANY ? '' : String(next))}
      items={options.map((option) => ({
        value: option.value || ANY,
        label: option.label,
      }))}
    >
      <SelectTrigger aria-label={label} className="df-blank">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className={cn('df-blank-menu', fontClassName)}
        alignItemWithTrigger={false}
        align="start"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value || ANY}
            value={option.value || ANY}
            className="df-blank-item"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface LocalityOption {
  key: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}

function LocalityBlank({
  locations,
  selectedLocation,
  onLocationChange,
  nearbyLabel,
  onSearchNearRequest,
  onSearchNear,
  nearbyPending,
  nearbyError,
  fontClassName,
}: {
  locations: string[];
  selectedLocation: string | null;
  onLocationChange: (value: string | null) => void;
  nearbyLabel: string | null;
  onSearchNearRequest: () => void;
  onSearchNear: (query: string, placeLabel?: string) => Promise<boolean>;
  nearbyPending: boolean;
  nearbyError: string | null;
  fontClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const term = query.trim().replace(/\s+/g, ' ');
  const needle = term.toLocaleLowerCase();

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  const matches = needle
    ? locations.filter((location) =>
        location.toLocaleLowerCase().includes(needle)
      )
    : locations;
  const options: LocalityOption[] = [
    ...(needle
      ? []
      : [
          {
            key: ANY,
            label: 'any locality',
            selected: !selectedLocation && !nearbyLabel,
            onSelect: () => {
              onLocationChange(null);
              close();
            },
          },
        ]),
    ...matches.flatMap((location, index) => {
      const selected = !nearbyLabel && selectedLocation === location;
      const option: LocalityOption = {
        key: `location:${location}`,
        label: location,
        selected,
        onSelect: () => {
          onLocationChange(location);
          close();
        },
      };
      if (!(selected || (needle && index < NEARBY_SUGGESTIONS))) {
        return [option];
      }
      return [
        option,
        {
          key: `nearby:${location}`,
          label: `${location} & nearby`,
          selected: false,
          onSelect: () => {
            void onSearchNear(location, location).then((found) => {
              if (found) close();
            });
          },
        },
      ];
    }),
    ...(nearbyLabel && !needle
      ? [
          {
            key: 'near-active',
            label: `near ${nearbyLabel}`,
            selected: true,
            onSelect: close,
          },
        ]
      : []),
    term.length >= 3
      ? {
          key: 'near-query',
          label: `Search near “${term}”`,
          selected: false,
          onSelect: () => {
            void onSearchNear(term).then((found) => {
              if (found) close();
            });
          },
        }
      : {
          key: 'near-request',
          label: 'a place not listed…',
          selected: false,
          onSelect: () => {
            close();
            onSearchNearRequest();
          },
        },
  ];
  const activeIndex = Math.min(active, options.length - 1);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger aria-label="Locality" className="df-blank">
        <span data-slot="select-value">
          {nearbyLabel
            ? `near ${nearbyLabel}`
            : (selectedLocation ?? 'any locality')}
        </span>
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('df-blank-menu df-locality', fontClassName)}
      >
        <div className="df-locality-search">
          <Search className="size-4" aria-hidden="true" />
          <input
            role="combobox"
            aria-label="Search localities"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={`${listId}-${activeIndex}`}
            value={query}
            placeholder="Type a locality"
            autoComplete="off"
            autoFocus
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((activeIndex + 1) % options.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((activeIndex - 1 + options.length) % options.length);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                options[activeIndex]?.onSelect();
              }
            }}
          />
          {nearbyPending && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label="Localities"
          className="df-locality-list"
        >
          {options.map((option, index) => (
            <div
              key={option.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.selected}
              data-highlighted={index === activeIndex ? '' : undefined}
              data-selected={option.selected ? '' : undefined}
              className="df-blank-item df-locality-item"
              onPointerMove={() => setActive(index)}
              onClick={option.onSelect}
            >
              {option.label}
              {option.selected && (
                <Check className="size-4" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
        {needle && matches.length === 0 && (
          <p className="df-near-hint">
            No listed locality matches. Search near it to see listings within 5
            km.
          </p>
        )}
        {nearbyError && (
          <p role="alert" className="df-near-error">
            {nearbyError}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function DealFloorHero({
  siteName,
  fontClassName,
  total,
  kinds,
  selectedType,
  onTypeChange,
  locations,
  selectedLocation,
  onLocationChange,
  nearbyLabel,
  onSearchNearRequest,
  onSearchNear,
  nearbyPending,
  nearbyError,
  maxBudget,
  onBudgetChange,
  matchCount,
  onSeeMatches,
  onPlay,
}: DealFloorHeroProps) {
  const [includeTried, setIncludeTried] = useState<string | null>(null);
  const typeValue = kinds.some((kind) => kind.key === selectedType)
    ? selectedType
    : 'All';
  return (
    <section className="df-hero" aria-label="Find a property">
      <span className="df-eyebrow">
        {total} live {total === 1 ? 'listing' : 'listings'} · {siteName}
      </span>
      <h1 className="df-serif df-hero-title">
        Show me{' '}
        <Blank
          label="Property kind"
          value={typeValue === 'All' ? '' : typeValue}
          options={[
            { value: '', label: 'any property' },
            ...kinds.map((kind) => ({
              value: kind.key,
              label: kind.label.toLocaleLowerCase(),
            })),
          ]}
          onChange={(value) => onTypeChange(value || 'All')}
          fontClassName={fontClassName}
        />{' '}
        in{' '}
        <LocalityBlank
          locations={locations}
          selectedLocation={selectedLocation}
          onLocationChange={onLocationChange}
          nearbyLabel={nearbyLabel}
          onSearchNearRequest={onSearchNearRequest}
          onSearchNear={onSearchNear}
          nearbyPending={nearbyPending}
          nearbyError={nearbyError}
          fontClassName={fontClassName}
        />{' '}
        <Blank
          label="Budget"
          value={maxBudget === null ? '' : String(maxBudget)}
          options={[
            { value: '', label: 'at any budget' },
            ...DEAL_FLOOR_BUDGETS.map((budget) => ({
              value: String(budget.max),
              label: budget.label,
            })),
          ]}
          onChange={(value) => onBudgetChange(value ? Number(value) : null)}
          fontClassName={fontClassName}
        />
      </h1>
      <div className="df-hero-actions">
        <button type="button" className="df-btn-accent" onClick={onSeeMatches}>
          See {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          <ArrowRight className="size-5" />
        </button>
        {selectedLocation && !nearbyLabel && (
          <button
            type="button"
            className="df-btn-link"
            disabled={nearbyPending}
            onClick={() => {
              setIncludeTried(selectedLocation);
              void onSearchNear(selectedLocation, selectedLocation);
            }}
          >
            {nearbyPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="size-4" aria-hidden="true" />
            )}
            Include places near {selectedLocation}
          </button>
        )}
        <button type="button" className="df-btn-link" onClick={onPlay}>
          <Play className="size-4" />
          or play Quick Picks
        </button>
      </div>
      {nearbyError &&
        !nearbyLabel &&
        selectedLocation &&
        includeTried === selectedLocation && (
          <p role="alert" className="df-near-error">
            {nearbyError}
          </p>
        )}
      <p className="df-hero-copy">
        Every choice narrows the catalogue live. Shortlist{' '}
        {MATCH_REPORT_SHORTLIST} and we send your match report on WhatsApp.
      </p>
    </section>
  );
}

const DEAL_TYPE_OPTIONS = [
  { value: 'All', label: 'Any deal type' },
  { value: 'Sale', label: 'For sale' },
  { value: 'Rent', label: 'For rent' },
  { value: 'JV/JD', label: 'JV / JD' },
  { value: 'Built to Suit', label: 'Built to suit' },
];

const BEDS_OPTIONS = [
  { value: 'All', label: 'Any BHK' },
  { value: '1', label: '1+ BHK' },
  { value: '2', label: '2+ BHK' },
  { value: '3', label: '3+ BHK' },
  { value: '4', label: '4+ BHK' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'area-high', label: 'Largest first' },
];

function Pill({
  label,
  value,
  defaultValue,
  options,
  onChange,
  disabled,
  fontClassName,
}: {
  label: string;
  value: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  fontClassName?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(String(next))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className="df-pill"
        data-active={value !== defaultValue ? 'true' : undefined}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className={cn('df-blank-menu', fontClassName)}
        alignItemWithTrigger={false}
        align="start"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="df-blank-item"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface DealFloorChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface DealFloorRefineProps {
  fontClassName?: string;
  listingType: string;
  onListingTypeChange: (value: string) => void;
  minBeds: string;
  onMinBedsChange: (value: string) => void;
  sortBy: string;
  onSortChange: (value: string) => void;
  nearbyActive: boolean;
  nearOpen: boolean;
  onNearOpenChange: (open: boolean) => void;
  onSearchNear: (query: string) => Promise<boolean>;
  nearbyPending: boolean;
  nearbyError: string | null;
  nearbyNote: string | null;
  chips: DealFloorChip[];
  onClearChips: () => void;
}

export function DealFloorRefine({
  fontClassName,
  listingType,
  onListingTypeChange,
  minBeds,
  onMinBedsChange,
  sortBy,
  onSortChange,
  nearbyActive,
  nearOpen,
  onNearOpenChange,
  onSearchNear,
  nearbyPending,
  nearbyError,
  nearbyNote,
  chips,
  onClearChips,
}: DealFloorRefineProps) {
  const [place, setPlace] = useState('');
  return (
    <div className="df-refine-block">
      <div className="df-refine" role="group" aria-label="Refine listings">
        <Pill
          label="Deal type"
          value={listingType}
          defaultValue="All"
          options={DEAL_TYPE_OPTIONS}
          onChange={onListingTypeChange}
          fontClassName={fontClassName}
        />
        <Pill
          label="Bedrooms"
          value={minBeds}
          defaultValue="All"
          options={BEDS_OPTIONS}
          onChange={onMinBedsChange}
          fontClassName={fontClassName}
        />
        <Pill
          label="Sort"
          value={nearbyActive ? 'nearest' : sortBy}
          defaultValue={nearbyActive ? 'nearest' : 'newest'}
          options={
            nearbyActive
              ? [{ value: 'nearest', label: 'Nearest first' }]
              : SORT_OPTIONS
          }
          onChange={onSortChange}
          disabled={nearbyActive}
          fontClassName={fontClassName}
        />
        <Popover open={nearOpen} onOpenChange={onNearOpenChange}>
          <PopoverTrigger
            className="df-pill"
            data-active={nearbyActive ? 'true' : undefined}
          >
            <LocateFixed className="size-4" aria-hidden="true" />
            Near a place
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className={cn('df-blank-menu df-near', fontClassName)}
          >
            <form
              className="df-near-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await onSearchNear(place)) {
                  setPlace('');
                  onNearOpenChange(false);
                }
              }}
            >
              <label className="df-near-label" htmlFor="df-near-input">
                Search near a place
              </label>
              <div className="df-near-row">
                <input
                  id="df-near-input"
                  value={place}
                  onChange={(event) => setPlace(event.target.value)}
                  placeholder="An area, landmark or road"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="df-btn-accent df-btn-small"
                  disabled={nearbyPending || place.trim().length < 3}
                >
                  {nearbyPending ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Search
                </button>
              </div>
              <p className="df-near-hint">
                Listings named there come first, then everything within 5 km.
              </p>
              {nearbyError && (
                <p role="alert" className="df-near-error">
                  {nearbyError}
                </p>
              )}
            </form>
          </PopoverContent>
        </Popover>
      </div>
      {chips.length > 0 && (
        <div className="df-active" aria-label="Active filters">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="df-chip df-chip-clear"
              aria-label={`Remove ${chip.label}`}
              onClick={chip.onRemove}
            >
              {chip.label}
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ))}
          {chips.length > 1 && (
            <button
              type="button"
              className="df-btn-link df-clear-all"
              onClick={onClearChips}
            >
              Clear these
            </button>
          )}
        </div>
      )}
      {nearbyNote && <p className="df-refine-note">{nearbyNote}</p>}
    </div>
  );
}

interface DealFloorKindsProps {
  total: number;
  kinds: DealFloorKindCount[];
  selectedType: string;
  onSelect: (value: string) => void;
}

export function DealFloorKinds({
  total,
  kinds,
  selectedType,
  onSelect,
}: DealFloorKindsProps) {
  const allSelected = !kinds.some((kind) => kind.key === selectedType);
  return (
    <section className="df-kinds" aria-label="Browse by kind">
      <span className="df-eyebrow">Browse by kind</span>
      <div className="df-kind-row">
        <button
          type="button"
          className="df-kind"
          aria-pressed={allSelected}
          onClick={() => onSelect('All')}
        >
          <span className="df-mono">{total}</span>
          <span>All</span>
        </button>
        {kinds.map((kind) => (
          <button
            key={kind.key}
            type="button"
            className="df-kind"
            aria-pressed={selectedType === kind.key}
            onClick={() => onSelect(kind.key)}
          >
            <span className="df-mono">{kind.count}</span>
            <span>{kind.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

interface DealFloorBoardProps {
  featured: Property | null;
  formatPrice: (amount: number) => string;
  onOpen: (property: Property) => void;
  newCount: number;
  recentOnly: boolean;
  onSeeNew: () => void;
  localities: Array<{ name: string; count: number }>;
  onPickLocality: (name: string) => void;
  onAsk: (query: string) => void;
  shortlistCount: number;
  onSendReport: () => void;
  onRequirements: () => void;
}

export function DealFloorBoard({
  featured,
  formatPrice,
  onOpen,
  newCount,
  recentOnly,
  onSeeNew,
  localities,
  onPickLocality,
  onAsk,
  shortlistCount,
  onSendReport,
  onRequirements,
}: DealFloorBoardProps) {
  const [question, setQuestion] = useState('');
  const remaining = Math.max(0, MATCH_REPORT_SHORTLIST - shortlistCount);
  const ratio = Math.min(1, shortlistCount / MATCH_REPORT_SHORTLIST);
  const circumference = 2 * Math.PI * 30;
  const [lead] = localities;
  const rest = localities.slice(1);

  return (
    <section className="df-board" aria-label="This week on the floor">
      <div className="df-section-head">
        <h2 className="df-serif">This week on the floor</h2>
        <span className="df-eyebrow">Updated daily</span>
      </div>
      <div className="df-board-grid">
        {featured && (
          <button
            type="button"
            className="df-tile df-tile-featured"
            onClick={() => onOpen(featured)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={storagePublicUrl(featured.images[0])}
              alt={featured.title}
              loading="lazy"
            />
            <span className="df-tile-tags">
              <span className="df-tag df-tag-accent">Featured</span>
              <span className="df-tag">{featured.type}</span>
            </span>
            <span className="df-tile-caption">
              <span className="df-serif df-tile-price">
                {dealFloorPriceLabel(featured, formatPrice)}
              </span>
              <span className="df-tile-title">{featured.title}</span>
              <span className="df-tile-meta">
                <MapPin className="size-3.5" />
                {dealFloorLocality(featured)}
                {featured.property_code ? ` · ${featured.property_code}` : ''}
              </span>
            </span>
          </button>
        )}

        <button
          type="button"
          className="df-tile df-tile-new"
          aria-pressed={recentOnly}
          onClick={onSeeNew}
        >
          <span className="df-eyebrow">New this week</span>
          <span className="df-serif df-tile-number">{newCount}</span>
          <span className="df-tile-link">
            {recentOnly ? 'Show everything' : 'See them'}
            <ArrowRight className="size-4" />
          </span>
        </button>

        <div className="df-tile df-tile-map">
          <span className="df-eyebrow">On the map</span>
          {lead ? (
            <>
              <button
                type="button"
                className="df-tile-lead"
                onClick={() => onPickLocality(lead.name)}
              >
                {lead.count} in {lead.name}
              </button>
              {rest.length > 0 && (
                <span className="df-tile-meta">
                  {rest.map((locality, position) => (
                    <span key={locality.name}>
                      {position > 0 && <span aria-hidden="true"> · </span>}
                      <button
                        type="button"
                        onClick={() => onPickLocality(locality.name)}
                      >
                        {locality.count} {locality.name}
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </>
          ) : (
            <span className="df-tile-meta">
              Localities appear as listings go live.
            </span>
          )}
        </div>

        <form
          className="df-tile df-tile-ask"
          onSubmit={(event) => {
            event.preventDefault();
            onAsk(question.trim());
          }}
        >
          <span className="df-eyebrow">
            <Search className="size-3.5" />
            Ask the catalogue
          </span>
          <span className="df-serif df-tile-quote">
            “2 BHK villa under 5 Cr” or “price &gt; 50 Cr”
          </span>
          <label className="df-ask-field">
            <span className="sr-only">Ask anything about these listings</span>
            <input
              type="search"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask anything about these listings"
            />
            <button type="submit" aria-label="Search the catalogue">
              <ArrowRight className="size-4" />
            </button>
          </label>
        </form>

        <div className="df-tile df-tile-report">
          <span className="df-eyebrow">Your match report</span>
          <div className="df-report-row">
            <svg viewBox="0 0 72 72" aria-hidden="true">
              <circle
                cx="36"
                cy="36"
                r="30"
                className="df-ring-track"
                strokeWidth="8"
              />
              <circle
                cx="36"
                cy="36"
                r="30"
                className="df-ring-fill"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${circumference * ratio} ${circumference}`}
                transform="rotate(-90 36 36)"
              />
              <text x="36" y="42" textAnchor="middle" className="df-ring-text">
                {Math.min(shortlistCount, MATCH_REPORT_SHORTLIST)}/
                {MATCH_REPORT_SHORTLIST}
              </text>
            </svg>
            <p>
              {remaining === 0
                ? `${shortlistCount} shortlisted. Your report is ready to send.`
                : `Shortlist ${remaining} more and we send your report on WhatsApp.`}
            </p>
          </div>
          {remaining === 0 ? (
            <button type="button" className="df-btn-ink" onClick={onSendReport}>
              <MessageCircle className="size-4" />
              Send it on WhatsApp
            </button>
          ) : (
            <button
              type="button"
              className="df-btn-ink"
              onClick={onRequirements}
            >
              Answer 3 quick questions instead
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
