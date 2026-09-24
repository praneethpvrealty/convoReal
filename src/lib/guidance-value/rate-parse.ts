import { PDFDocument } from 'pdf-lib';

import { generateJsonFromParts, type GeminiPart } from '@/lib/ai/gemini';
import { parseJsonResponse } from '@/lib/invoices/document-extract';

import {
  PROPERTY_CLASSES,
  type ParsedRateRow,
  type PropertyClass,
} from './types';
import { normaliseUnit } from './units';

export const PAGES_PER_CHUNK = 2;
export const MAX_ROWS_PER_CHUNK = 1500;

const AI_UNAVAILABLE_PATTERNS = [
  /credits are depleted/i,
  /prepayment/i,
  /api key not valid/i,
  /api key expired/i,
  /GEMINI_API_KEY is not configured/,
];

const AI_RATE_LIMITED_PATTERNS = [
  /quota/i,
  /resource[_ ]?exhausted/i,
  /rate limit/i,
];

export type AiOutage = 'unavailable' | 'rate_limited';

export function classifyAiOutage(message: string): AiOutage | null {
  if (AI_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message)))
    return 'unavailable';
  if (AI_RATE_LIMITED_PATTERNS.some((pattern) => pattern.test(message)))
    return 'rate_limited';
  if (/billing/i.test(message)) return 'unavailable';
  return null;
}

export function countPdfPages(buffer: Uint8Array): number | null {
  const text = Buffer.from(buffer).toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches && matches.length > 0 ? matches.length : null;
}

export interface RateHeadings {
  district?: string | null;
  taluk?: string | null;
  hobli?: string | null;
  village?: string | null;
  locality?: string | null;
}

export interface PdfSlice {
  bytes: Uint8Array;
  pageCount: number;
  firstPage: number;
  lastPage: number;
}

export async function slicePdf(
  buffer: Uint8Array,
  fromPage: number,
  toPage: number
): Promise<PdfSlice | null> {
  try {
    const source = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pageCount = source.getPageCount();
    const firstPage = Math.max(1, fromPage - 1);
    const lastPage = Math.min(toPage, pageCount);
    if (firstPage > lastPage) return null;
    const slice = await PDFDocument.create();
    const indices = Array.from(
      { length: lastPage - firstPage + 1 },
      (_, i) => firstPage - 1 + i
    );
    const pages = await slice.copyPages(source, indices);
    for (const page of pages) slice.addPage(page);
    return {
      bytes: await slice.save(),
      pageCount,
      firstPage,
      lastPage,
    };
  } catch {
    return null;
  }
}

function scopeInstructions(
  fromPage: number,
  toPage: number,
  slice: PdfSlice | null
): string {
  if (!slice) {
    return `Read ONLY pages ${fromPage} to ${toPage} of the attached PDF (1-based page numbers).`;
  }
  const context =
    slice.firstPage < fromPage
      ? ` Page ${slice.firstPage} is included only so you can carry its headings forward; do not return rows from it.`
      : '';
  return `The attached PDF is an excerpt: its pages are pages ${slice.firstPage} to ${slice.lastPage} of the notification, in order, so its first page is page ${slice.firstPage}. Transcribe ONLY pages ${fromPage} to ${Math.min(toPage, slice.lastPage)} and report page numbers of the full notification.${context}`;
}

function headingsInstructions(headings?: RateHeadings | null): string {
  if (!headings) return '';
  const known = (['district', 'taluk', 'hobli', 'village', 'locality'] as const)
    .filter((key) => headings[key])
    .map((key) => `${key} "${headings[key]}"`);
  return known.length
    ? `\nThe last row before these pages had ${known.join(', ')}. Carry those headings into rows until a new heading replaces them.`
    : '';
}

export function rateInstructions(
  fromPage: number,
  toPage: number,
  slice: PdfSlice | null = null,
  headings?: RateHeadings | null
): string {
  return `
You are transcribing a Karnataka guidance value notification (the
government's market value guidelines, published by the Central Valuation
Committee / Department of Stamps and Registration). ${scopeInstructions(fromPage, toPage, slice)}${headingsInstructions(headings)}

Return JSON: {"total_pages": number, "rows": [...]}. Each row is ONE rate:
  district        district name, carried down from headings
  taluk           taluk / sub-registrar office name, carried down
  hobli           hobli name, carried down
  village         revenue village name, or the ward / area for urban
                  tables, carried down from headings
  locality        the area, layout, extension, block or colony the rate is
                  for, e.g. "Koramangala 6th Block"
  road            the street or road if the rate is for one road only,
                  e.g. "18th Main"; omit when the rate covers the whole area
  survey_numbers  survey numbers the rate covers, as printed
  property_class  one of ${PROPERTY_CLASSES.map((c) => `"${c}"`).join(', ')}
  rate            the number only, no commas or currency
  unit            "sqm", "sqft", "acre", "gunta" or "hectare" as the column
                  header states
  page            the 1-based page number the row is on

A table with separate columns for residential site, residential
apartment, commercial site and commercial apartment produces one row per
non-empty column. Agricultural dry / wet / garden land rates are
"agricultural". Tables are often bilingual; transcribe the English names.
Carry headings (district, taluk, hobli, village) down to every row under
them, including headings printed on an earlier page when the table
continues. Skip blank, "-", or "NA" cells. Return ONLY valid JSON.`;
}

function cleanString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return trimmed || undefined;
}

function parseClass(value: unknown): PropertyClass | null {
  const text = cleanString(value, 40)
    ?.toLowerCase()
    .replace(/[\s-]+/g, '_');
  return text && (PROPERTY_CLASSES as readonly string[]).includes(text)
    ? (text as PropertyClass)
    : null;
}

export function sanitiseRateRows(
  raw: unknown,
  fromPage: number,
  toPage: number,
  contextPage: number | null = null
): { rows: ParsedRateRow[]; totalPages: number | null } {
  if (!raw || typeof raw !== 'object') return { rows: [], totalPages: null };
  const input = raw as { rows?: unknown; total_pages?: unknown };
  const totalPages = Number(input.total_pages);
  const rows: ParsedRateRow[] = [];

  for (const item of Array.isArray(input.rows) ? input.rows : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const propertyClass = parseClass(row.property_class);
    const unit = normaliseUnit(row.unit);
    const rate = Number(
      typeof row.rate === 'string' ? row.rate.replace(/[^\d.]/g, '') : row.rate
    );
    if (!propertyClass || !unit || !Number.isFinite(rate) || rate <= 0)
      continue;
    const locality = cleanString(row.locality);
    const village = cleanString(row.village);
    const road = cleanString(row.road);
    if (!locality && !village && !road) continue;

    const page = Number(row.page);
    if (contextPage !== null && page === contextPage) continue;
    const out: ParsedRateRow = {
      property_class: propertyClass,
      rate,
      unit,
      page:
        Number.isInteger(page) && page >= fromPage && page <= toPage
          ? page
          : fromPage,
    };
    for (const key of ['district', 'taluk', 'hobli'] as const) {
      const value = cleanString(row[key]);
      if (value) out[key] = value;
    }
    if (village) out.village = village;
    if (locality) out.locality = locality;
    if (road) out.road = road;
    const surveys = cleanString(row.survey_numbers, 400);
    if (surveys) out.survey_numbers = surveys;
    rows.push(out);
    if (rows.length >= MAX_ROWS_PER_CHUNK) break;
  }

  return {
    rows,
    totalPages:
      Number.isInteger(totalPages) && totalPages > 0 ? totalPages : null,
  };
}

export async function parseRatePages(input: {
  buffer: Uint8Array;
  fromPage: number;
  toPage: number;
  headings?: RateHeadings | null;
}): Promise<{ rows: ParsedRateRow[]; totalPages: number | null }> {
  const slice = await slicePdf(input.buffer, input.fromPage, input.toPage);
  const parts: GeminiPart[] = [
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: Buffer.from(slice?.bytes ?? input.buffer).toString('base64'),
      },
    },
    {
      text: `Transcribe the guidance value rates on pages ${input.fromPage} to ${input.toPage}.`,
    },
  ];
  const response = await generateJsonFromParts(
    parts,
    rateInstructions(input.fromPage, input.toPage, slice, input.headings),
    {
      feature: 'guidance_value_source_parse',
      apiKey: process.env.GEMINI_IMPORT_API_KEY,
    }
  );
  const parsed = sanitiseRateRows(
    parseJsonResponse(response),
    input.fromPage,
    input.toPage,
    slice && slice.firstPage < input.fromPage ? slice.firstPage : null
  );
  return slice ? { ...parsed, totalPages: slice.pageCount } : parsed;
}
