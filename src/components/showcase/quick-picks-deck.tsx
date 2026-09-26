'use client';

import { useState } from 'react';
import { Bookmark, MapPin, MessageCircle, X } from 'lucide-react';
import type { Property } from '@/types';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import { storagePublicUrl } from '@/lib/storage/url';
import {
  dealFloorLocality,
  dealFloorPriceLabel,
  MATCH_REPORT_SHORTLIST,
  QUICK_PICKS_ROUND,
  quickPickOrder,
  tasteSummary,
} from '@/lib/showcase/deal-floor';
import { PlotFace } from '@/components/showcase/plot-face';

interface QuickPicksDeckProps {
  properties: Property[];
  shortlistIds: string[];
  onToggleShortlist: (id: string) => void;
  onOpen: (property: Property) => void;
  formatPrice: (amount: number) => string;
  whatsAppLink: (property: Property) => string | null;
  onWhatsApp: (property: Property) => void;
  onSendReport: () => void;
  onRequirements: () => void;
  onExit: () => void;
}

type Verdict = 'like' | 'skip';

export function QuickPicksDeck({
  properties,
  shortlistIds,
  onToggleShortlist,
  onOpen,
  formatPrice,
  whatsAppLink,
  onWhatsApp,
  onSendReport,
  onRequirements,
  onExit,
}: QuickPicksDeckProps) {
  const [deck] = useState(() =>
    quickPickOrder(properties)
      .filter((property) => !shortlistIds.includes(property.id))
      .slice(0, QUICK_PICKS_ROUND)
  );
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<
    Array<{ id: string; verdict: Verdict }>
  >([]);

  const finished = index >= deck.length;
  const card = finished ? null : deck[index];
  const next = deck[index + 1] ?? null;
  const liked = history
    .filter((entry) => entry.verdict === 'like')
    .flatMap((entry) => deck.find((item) => item.id === entry.id) ?? []);

  function advance(verdict: Verdict) {
    if (!card) return;
    if (verdict === 'like' && !shortlistIds.includes(card.id)) {
      onToggleShortlist(card.id);
    }
    setHistory((current) => [...current, { id: card.id, verdict }]);
    setIndex((current) => current + 1);
  }

  function undo() {
    const last = history.at(-1);
    if (!last) return;
    if (last.verdict === 'like' && shortlistIds.includes(last.id)) {
      onToggleShortlist(last.id);
    }
    setHistory((current) => current.slice(0, -1));
    setIndex((current) => current - 1);
  }

  if (deck.length === 0) {
    return (
      <section className="df-deck df-deck-empty" aria-label="Quick Picks">
        <p>Every listing here is already on your shortlist.</p>
        <button type="button" className="df-btn-ghost" onClick={onExit}>
          Back to the grid
        </button>
      </section>
    );
  }

  if (finished) {
    const summary = tasteSummary(liked);
    const reportReady = shortlistIds.length >= MATCH_REPORT_SHORTLIST;
    return (
      <section
        className="df-deck df-deck-done"
        aria-label="Quick Picks round complete"
      >
        <span className="df-eyebrow">
          Your taste, from {liked.length}{' '}
          {liked.length === 1 ? 'pick' : 'picks'}
        </span>
        <h3 className="df-serif df-deck-headline">{summary.headline}</h3>
        {summary.chips.length > 0 && (
          <ul className="df-chip-row" aria-label="What you liked">
            {summary.chips.map((chip) => (
              <li key={chip} className="df-chip">
                {chip}
              </li>
            ))}
          </ul>
        )}
        {liked.length > 0 && (
          <ul className="df-deck-liked" aria-label="Shortlisted this round">
            {liked.map((property) => (
              <li key={property.id}>
                <button type="button" onClick={() => onOpen(property)}>
                  {property.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={showcaseImageUrl(
                        storagePublicUrl(property.images[0]),
                        SHOWCASE_IMAGE_WIDTHS.thumb
                      )}
                      alt={property.title}
                      loading="lazy"
                    />
                  ) : (
                    <PlotFace property={property} />
                  )}
                  <span>{dealFloorPriceLabel(property, formatPrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="df-deck-actions df-deck-actions-column">
          {reportReady ? (
            <button
              type="button"
              className="df-btn-whatsapp"
              onClick={onSendReport}
            >
              <MessageCircle className="size-5" />
              Send my {shortlistIds.length} picks on WhatsApp
            </button>
          ) : (
            <button
              type="button"
              className="df-btn-accent"
              onClick={onRequirements}
            >
              Tell us what you want instead
            </button>
          )}
          <button
            type="button"
            className="df-btn-ghost"
            onClick={() => {
              setIndex(0);
              setHistory([]);
            }}
          >
            Play the round again
          </button>
          <button type="button" className="df-btn-link" onClick={onExit}>
            Back to the grid
          </button>
        </div>
      </section>
    );
  }

  const current = card as Property;
  const image = current.images?.[0]
    ? storagePublicUrl(current.images[0])
    : null;
  const link = whatsAppLink(current);

  return (
    <section className="df-deck" aria-label="Quick Picks">
      <div className="df-deck-top">
        <button
          type="button"
          className="df-btn-ghost df-btn-small"
          onClick={undo}
          disabled={history.length === 0}
        >
          Undo
        </button>
        <div className="df-deck-progress">
          <span className="df-eyebrow">
            Quick Picks · {index + 1} of {deck.length}
          </span>
          <div className="df-deck-dots" aria-hidden="true">
            {deck.map((item, position) => {
              const entry = history[position];
              const state = entry
                ? entry.verdict === 'like'
                  ? 'liked'
                  : 'skipped'
                : position === index
                  ? 'current'
                  : 'pending';
              return <span key={item.id} data-state={state} />;
            })}
          </div>
        </div>
        <button
          type="button"
          className="df-btn-ghost df-btn-small"
          onClick={onExit}
        >
          Grid
        </button>
      </div>

      <div className="df-deck-stage">
        {next && (
          <div className="df-deck-under" aria-hidden="true">
            {next.images?.[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={showcaseImageUrl(
                  storagePublicUrl(next.images[0]),
                  SHOWCASE_IMAGE_WIDTHS.card
                )}
                alt=""
                loading="lazy"
              />
            )}
          </div>
        )}
        <article key={current.id} className="df-deck-card">
          <button
            type="button"
            className="df-deck-photo"
            onClick={() => onOpen(current)}
            aria-label={`Open ${current.title}`}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={showcaseImageUrl(image, SHOWCASE_IMAGE_WIDTHS.hero)}
                alt={current.title}
                onError={(event) => {
                  if (event.currentTarget.src !== image)
                    event.currentTarget.src = image;
                }}
              />
            ) : (
              <PlotFace property={current} />
            )}
            <span className="df-tag">{current.type}</span>
            {current.property_code && (
              <span className="df-tag df-tag-accent">
                {current.property_code}
              </span>
            )}
            <span className="df-serif df-deck-price">
              {dealFloorPriceLabel(current, formatPrice)}
            </span>
          </button>
          <div className="df-deck-body">
            <h3>{current.title}</h3>
            <p>
              <MapPin className="size-3.5" />
              {dealFloorLocality(current)}
            </p>
            <p className="df-deck-hint">
              Shortlist it if you would visit. Skip if not.{' '}
              {MATCH_REPORT_SHORTLIST} picks unlock your match report.
            </p>
          </div>
        </article>
      </div>

      <div className="df-deck-actions">
        <button
          type="button"
          className="df-deck-skip"
          aria-label={`Skip ${current.title}`}
          onClick={() => advance('skip')}
        >
          <X className="size-6" />
        </button>
        <button
          type="button"
          className="df-btn-accent df-deck-like"
          onClick={() => advance('like')}
        >
          <Bookmark className="size-5" />
          Shortlist
        </button>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="df-deck-ask"
            aria-label={`Ask about ${current.title} on WhatsApp`}
            onClick={() => onWhatsApp(current)}
          >
            <MessageCircle className="size-6" />
          </a>
        ) : (
          <button
            type="button"
            className="df-deck-ask"
            aria-label={`Open ${current.title}`}
            onClick={() => onOpen(current)}
          >
            <MessageCircle className="size-6" />
          </button>
        )}
      </div>
    </section>
  );
}
