// ============================================================
// Rendering. Every tool answers in one of two formats:
//
//   markdown — the default. Compact, human-shaped, and far cheaper in
//              tokens than the equivalent JSON.
//   json     — the full envelope, for when the caller is going to
//              compute over the result rather than read it.
//
// Both come back from the same helpers so the two never drift, and the
// structured payload is always attached as `structuredContent`
// regardless of which text form was asked for.
// ============================================================

export const ResponseFormat = {
  MARKDOWN: 'markdown',
  JSON: 'json',
} as const;

export type ResponseFormatValue =
  (typeof ResponseFormat)[keyof typeof ResponseFormat];

/** Beyond this a response stops being useful context and starts
 *  crowding out the conversation it was fetched for. */
export const CHARACTER_LIMIT = 25_000;

export interface PageEnvelope<T> {
  items: T[];
  total: number | null;
  count: number;
  offset: number;
  limit: number;
  has_more: boolean;
  next_offset: number | null;
  note?: string;
}

/**
 * Indian short-form money: 1.25 Cr, 85 L, ₹40,000.
 *
 * Mirrors `formatCurrencyShort` in src/lib/currency-utils.ts. It is
 * copied rather than imported because this package has its own
 * dependency tree and no path into the Next.js app; if the app's
 * version changes, change this one too.
 */
export function formatMoney(
  value: number | null | undefined,
  currency = 'INR'
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  if (currency !== 'INR') return `${currency} ${value.toLocaleString('en-US')}`;
  if (value >= 10_000_000) return `₹${trimZero(value / 10_000_000)} Cr`;
  if (value >= 100_000) return `₹${trimZero(value / 100_000)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

function trimZero(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

/** `label: value` lines, skipping anything empty so a sparse record
 *  does not render as a wall of em-dashes. */
export function bullets(pairs: [string, unknown][]): string {
  return pairs
    .filter(
      ([, value]) =>
        value !== null && value !== undefined && value !== '' && value !== '—'
    )
    .map(([label, value]) => `- **${label}**: ${value}`)
    .join('\n');
}

interface RenderOptions<T> {
  title: string;
  page: PageEnvelope<T>;
  /** One markdown block per item. */
  renderItem: (item: T, index: number) => string;
  /** Shown when the page is empty — say how to widen the search. */
  emptyHint: string;
  format: ResponseFormatValue;
}

/**
 * Render a paged result in the requested format and attach the raw
 * envelope as structured content.
 *
 * Truncation is by item, not by character: cutting a markdown document
 * mid-table leaves the model reading a fragment it cannot tell is a
 * fragment. Dropping whole items and saying how many were dropped
 * keeps every rendered item complete.
 */
export function renderPage<T>({
  title,
  page,
  renderItem,
  emptyHint,
  format,
}: RenderOptions<T>): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  if (page.count === 0) {
    // A caller that asked for JSON gets JSON even here — it is going to
    // parse the result, and prose would throw.
    const text =
      format === ResponseFormat.JSON
        ? JSON.stringify(page, null, 2)
        : (page.note ?? `No results. ${emptyHint}`);
    return {
      content: [{ type: 'text', text }],
      structuredContent: page as unknown as Record<string, unknown>,
    };
  }

  let items = page.items;
  let dropped = 0;

  let text = build(title, page, items, renderItem, dropped, format);
  while (text.length > CHARACTER_LIMIT && items.length > 1) {
    const keep = Math.max(1, Math.floor(items.length / 2));
    dropped += items.length - keep;
    items = items.slice(0, keep);
    text = build(title, page, items, renderItem, dropped, format);
  }

  return {
    content: [{ type: 'text', text }],
    structuredContent: page as unknown as Record<string, unknown>,
  };
}

function build<T>(
  title: string,
  page: PageEnvelope<T>,
  items: T[],
  renderItem: (item: T, index: number) => string,
  dropped: number,
  format: ResponseFormatValue
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(
      { ...page, items, ...(dropped ? { truncated: true, dropped } : {}) },
      null,
      2
    );
  }

  const shown =
    page.total === null
      ? `${items.length}`
      : `${items.length} of ${page.total}`;
  const lines = [`# ${title}`, '', `Showing ${shown}.`];

  if (page.note) lines.push('', `> ${page.note}`);
  lines.push('');
  items.forEach((item, i) => {
    lines.push(renderItem(item, page.offset + i));
    lines.push('');
  });

  if (dropped > 0) {
    lines.push(
      `_${dropped} further result(s) omitted to stay within the response size limit. Narrow the search with filters, or lower \`limit\`._`
    );
  }
  if (page.has_more && page.next_offset !== null) {
    lines.push(
      `_More available — call again with \`offset: ${page.next_offset}\`._`
    );
  }

  return lines.join('\n').trimEnd();
}

/** Single-record rendering, sharing the JSON branch with pages. */
export function renderRecord(
  title: string,
  body: string,
  raw: Record<string, unknown>,
  format: ResponseFormatValue
): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  const text =
    format === ResponseFormat.JSON
      ? JSON.stringify(raw, null, 2)
      : [`# ${title}`, '', body].join('\n');

  return { content: [{ type: 'text', text }], structuredContent: raw };
}
