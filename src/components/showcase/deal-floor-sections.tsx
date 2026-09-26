'use client';

import { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  MapPin,
  MessageCircle,
  Play,
  Search,
} from 'lucide-react';
import type { Property } from '@/types';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
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
  total: number;
  kinds: DealFloorKindCount[];
  selectedType: string;
  onTypeChange: (value: string) => void;
  locations: string[];
  selectedLocation: string | null;
  onLocationChange: (value: string | null) => void;
  maxBudget: number | null;
  onBudgetChange: (value: number | null) => void;
  matchCount: number;
  onSeeMatches: () => void;
  onPlay: () => void;
}

function Blank({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <span className="df-blank">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown className="size-5" aria-hidden="true" />
    </span>
  );
}

export function DealFloorHero({
  siteName,
  total,
  kinds,
  selectedType,
  onTypeChange,
  locations,
  selectedLocation,
  onLocationChange,
  maxBudget,
  onBudgetChange,
  matchCount,
  onSeeMatches,
  onPlay,
}: DealFloorHeroProps) {
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
        <Blank label="Property kind" value={typeValue} onChange={onTypeChange}>
          <option value="All">any property</option>
          {kinds.map((kind) => (
            <option key={kind.key} value={kind.key}>
              {kind.label.toLocaleLowerCase()}
            </option>
          ))}
        </Blank>{' '}
        in{' '}
        <Blank
          label="Locality"
          value={selectedLocation ?? ''}
          onChange={(value) => onLocationChange(value || null)}
        >
          <option value="">any locality</option>
          {locations.map((location) => (
            <option key={location} value={location}>
              {location}
            </option>
          ))}
        </Blank>{' '}
        <Blank
          label="Budget"
          value={maxBudget === null ? '' : String(maxBudget)}
          onChange={(value) => onBudgetChange(value ? Number(value) : null)}
        >
          <option value="">at any budget</option>
          {DEAL_FLOOR_BUDGETS.map((budget) => (
            <option key={budget.max} value={budget.max}>
              {budget.label}
            </option>
          ))}
        </Blank>
      </h1>
      <div className="df-hero-actions">
        <button type="button" className="df-btn-accent" onClick={onSeeMatches}>
          See {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          <ArrowRight className="size-5" />
        </button>
        <button type="button" className="df-btn-link" onClick={onPlay}>
          <Play className="size-4" />
          or play Quick Picks
        </button>
      </div>
      <p className="df-hero-copy">
        Every choice narrows the catalogue live. Shortlist{' '}
        {MATCH_REPORT_SHORTLIST} and we send your match report on WhatsApp.
      </p>
    </section>
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
              src={showcaseImageUrl(
                storagePublicUrl(featured.images[0]),
                SHOWCASE_IMAGE_WIDTHS.hero
              )}
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
