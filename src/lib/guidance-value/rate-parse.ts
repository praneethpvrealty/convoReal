import { PDFDocument } from 'pdf-lib';

import {
  classifyGeminiKeyFailure,
  generateJsonFromParts,
  isOutputCutOff,
  type GeminiPart,
  type GeminiTier,
} from '@/lib/ai/gemini';
import { parseJsonResponse } from '@/lib/invoices/document-extract';

import {
  PROPERTY_CLASSES,
  type AreaUnit,
  type LandClass,
  type ParsedRateRow,
  type PropertyClass,
} from './types';
import { normaliseUnit } from './units';

export const PAGES_PER_CHUNK = 2;
export const RATE_READ_TIMEOUT_MS = 80_000;
export const RATE_MAX_OUTPUT_TOKENS = 8_192;
export const MAX_ROWS_PER_CHUNK = 1500;

export type AiOutage = 'unavailable' | 'rate_limited';

export function classifyAiOutage(message: string): AiOutage | null {
  if (/GEMINI_API_KEY is not configured/.test(message)) return 'unavailable';
  const failure = classifyGeminiKeyFailure(message);
  if (failure === 'exhausted') return 'unavailable';
  return failure;
}

export function rateParseTier(): GeminiTier {
  return process.env.GEMINI_IMPORT_TIER === 'standard' ? 'standard' : 'lite';
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

export async function openPdf(buffer: Uint8Array): Promise<PDFDocument | null> {
  try {
    return await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    return null;
  }
}

export async function slicePdf(
  input: Uint8Array | PDFDocument,
  fromPage: number,
  toPage: number
): Promise<PdfSlice | null> {
  try {
    const source = input instanceof PDFDocument ? input : await openPdf(input);
    if (!source) return null;
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

export const RATE_CLASS_CODES: Record<string, PropertyClass> = {
  rs: 'residential_site',
  ra: 'residential_apartment',
  cs: 'commercial_site',
  ca: 'commercial_apartment',
  in: 'industrial',
  ag: 'agricultural',
  ad: 'agricultural',
  aw: 'agricultural',
  ab: 'agricultural',
  ap: 'agricultural',
  ot: 'other',
};

export const LAND_CLASS_CODES: Record<string, LandClass> = {
  ad: 'dry',
  aw: 'wet',
  ab: 'garden',
  ap: 'plantation',
};

function unitInstructions(unit?: AreaUnit | null): string {
  if (!unit) return '';
  const name = unit === 'sqm' ? 'square metre ("sqm")' : 'square foot ("sqft")';
  return `\nThis notification's rate header states rates per ${name}. Unless a table on these pages prints its own unit, write that unit for site and building rates; keep land rates in the acre, gunta or hectare unit their column states.`;
}

export function rateInstructions(
  fromPage: number,
  toPage: number,
  slice: PdfSlice | null = null,
  headings?: RateHeadings | null,
  unit?: AreaUnit | null
): string {
  return `
You are transcribing a Karnataka guidance value notification (the
government's market value guidelines, published by the Central Valuation
Committee / Department of Stamps and Registration). ${scopeInstructions(fromPage, toPage, slice)}${headingsInstructions(headings)}${unitInstructions(unit)}

Return compact JSON, writing each heading once:
{"total_pages": number, "groups": [
  {"district": "...", "taluk": "...", "hobli": "...", "village": "...",
   "rows": [[locality, road, survey_numbers, unit, page, {code: rate}], ...]}
]}

A group is every rate under one district / taluk (sub-registrar office) /
hobli / village heading; village is the revenue village, or the ward or
area for urban tables. Start a new group whenever any heading changes and
give every group the headings printed above its rows, carried down from
earlier headings on these pages or the page before them. Copy headings
exactly as printed and never infer one from a place name you recognise:
write "" for any heading not printed on these pages, and it is carried
over from the pages before.

Transcribe only the area-wise guidance value tables. Skip construction
cost and building-type tables, floor-rise or additional-floor rates,
parking charges, ready reckoners, worked examples and general guideline
or instruction pages; return no rows for them.

Each row is one line of the table:
  locality        the area, layout, extension, block or colony, e.g.
                  "Koramangala 6th Block"
  road            the street or road if the rate is for one road only,
                  e.g. "18th Main"; "" when it covers the whole area
  survey_numbers  survey numbers as printed, or ""
  unit            "sqm", "sqft", "acre", "gunta" or "hectare" as the
                  column header states; never assume one the notification
                  does not print. Read the Kannada header too: it often
                  gives the land unit alone, e.g. "ಪ್ರತಿ ಎಕರೆಗೆ
                  ಲಕ್ಷಗಳಲ್ಲಿ" (per acre, in lakhs); ಎಕರೆ is acre, ಗುಂಟೆ
                  gunta, ಹೆಕ್ಟೇರ್ hectare, ಚದರ ಮೀಟರ್ sqm, ಚದರ ಅಡಿ sqft.
                  When a header prints rates in lakhs or crores ("Rs. in
                  lakhs per acre", "ಲಕ್ಷಗಳಲ್ಲಿ", "ಕೋಟಿ"), write "lakh/acre"
                  or "crore/acre" (likewise for other units) and copy the
                  number as printed
  page            the 1-based page number the line is on
  {code: rate}    one entry per non-empty rate column, the number only
                  with no commas or currency. Codes: "rs" residential
                  site, "ra" residential apartment, "cs" commercial site,
                  "ca" commercial apartment, "in" industrial, "ot" other.
                  Agricultural land uses the column's land class: "ad"
                  dry land (Khushki, Kushki, Punja, ಖುಷ್ಕಿ, ಪುಂಜ), "aw"
                  wet land (Tari, Nanja, irrigated, ತರಿ, ನಂಜ), "ab"
                  garden land (Bagayat, ಬಾಗಾಯ್ತು, ಭಾಗಾಯ್ತು), "ap"
                  plantation (coconut, arecanut, coffee, ತೆಂಗು, ಅಡಿಕೆ);
                  "ag" only when the column names no land class.

If two columns of one line use different units, write one row per unit.
A village line often prints its land rates (dry, wet, garden) followed by
a site rate for gramathana or local-authority sites: give the land columns
their land codes and only the site column "rs", never a site, apartment
or commercial code for a land column. Land columns never take the site
column's unit: write them as their own row with the land unit. Karnataka
village tables print land in rupees per acre or in lakhs per acre, the
lakh often stated only in the Kannada header; a land figure under 1000 is
lakhs, so write "lakh/acre" unless its header prints another land unit.
Never do this for a column printed per gunta, hectare, square metre or
square foot.
Tables are often bilingual; transcribe the English names. Skip blank,
"-", or "NA" cells. Return ONLY valid JSON.`;
}

const RATE_SCALE =
  /^\s*(?:rs\.?\s*)?(?:in\s*)?(lakhs?|lacs?|crores?)\s*(?:\/|per\b)?\s*/i;

export function scaledUnit(
  raw: unknown
): { unit: AreaUnit; scale: number } | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(RATE_SCALE);
  const unit = normaliseUnit(match ? raw.slice(match[0].length) : raw);
  if (!unit) return null;
  const scale = !match ? 1 : /^cr/i.test(match[1]) ? 10_000_000 : 100_000;
  return { unit, scale };
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
  if (!text) return null;
  if (RATE_CLASS_CODES[text]) return RATE_CLASS_CODES[text];
  return (PROPERTY_CLASSES as readonly string[]).includes(text)
    ? (text as PropertyClass)
    : null;
}

const HEADING_KEYS = ['district', 'taluk', 'hobli', 'village'] as const;

export const NON_RATE_TABLE =
  /\b(ready reckoner|construction (rates?|costs?)|building (rates?|types?|construction|costs?)|parking (charges|rates)|additional (floor|rate for apartment floors)|floor[- ]?(wise|rise|rates?|weightage|additional)|(calculation|worked) examples?|general guidelines?|special instructions|conversion guidelines|statewide|madras terrace|kadapa terrace|mangalore tiles)\b/i;

function isNonRateLabel(value: unknown): boolean {
  return typeof value === 'string' && NON_RATE_TABLE.test(value);
}

function isNonRateGroup(group: Record<string, unknown>): boolean {
  if (HEADING_KEYS.some((key) => isNonRateLabel(group[key]))) return true;
  const lines = (Array.isArray(group.rows) ? group.rows : []).filter(
    Array.isArray
  );
  return lines.length > 0 && lines.every((line) => isNonRateLabel(line[0]));
}

function isNonRateTable(row: RawRate): boolean {
  return [row.headings.village, row.locality].some(isNonRateLabel);
}

interface RawRate {
  headings: Record<string, unknown>;
  locality: unknown;
  road: unknown;
  survey_numbers: unknown;
  property_class: unknown;
  rate: unknown;
  unit: unknown;
  page: unknown;
}

function compactRates(groups: unknown[]): RawRate[] {
  const out: RawRate[] = [];
  let carried: Record<string, unknown> = {};
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const g = group as Record<string, unknown>;
    const headings: Record<string, unknown> = { ...carried };
    for (const key of HEADING_KEYS) {
      if (typeof g[key] === 'string') headings[key] = g[key];
    }
    if (isNonRateGroup(g)) continue;
    carried = headings;
    for (const line of Array.isArray(g.rows) ? g.rows : []) {
      if (!Array.isArray(line)) continue;
      const [locality, road, surveys, unit, page, rates] = line;
      if (!rates || typeof rates !== 'object' || Array.isArray(rates)) continue;
      for (const [code, rate] of Object.entries(rates)) {
        out.push({
          headings,
          locality,
          road,
          survey_numbers: surveys,
          property_class: code,
          rate,
          unit,
          page,
        });
      }
    }
  }
  return out;
}

function legacyRates(rows: unknown[]): RawRate[] {
  const out: RawRate[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    out.push({
      headings: row,
      locality: row.locality,
      road: row.road,
      survey_numbers: row.survey_numbers,
      property_class: row.property_class,
      rate: row.rate,
      unit: row.unit,
      page: row.page,
    });
  }
  return out;
}

export function sanitiseRateRows(
  raw: unknown,
  fromPage: number,
  toPage: number,
  contextPage: number | null = null
): { rows: ParsedRateRow[]; totalPages: number | null } {
  if (!raw || typeof raw !== 'object') return { rows: [], totalPages: null };
  const input = raw as {
    rows?: unknown;
    groups?: unknown;
    total_pages?: unknown;
  };
  const totalPages = Number(input.total_pages);
  const rows: ParsedRateRow[] = [];
  const candidates = Array.isArray(input.groups)
    ? compactRates(input.groups)
    : legacyRates(Array.isArray(input.rows) ? input.rows : []);

  for (const row of candidates) {
    if (isNonRateTable(row)) continue;
    const propertyClass = parseClass(row.property_class);
    const landClass =
      propertyClass === 'agricultural'
        ? LAND_CLASS_CODES[
            cleanString(row.property_class, 4)?.toLowerCase() ?? ''
          ]
        : undefined;
    const scaled = scaledUnit(row.unit);
    const printed = Number(
      typeof row.rate === 'string' ? row.rate.replace(/[^\d.]/g, '') : row.rate
    );
    if (!propertyClass || !scaled || !Number.isFinite(printed) || printed <= 0)
      continue;
    const { unit } = scaled;
    const rate = Math.round(printed * scaled.scale * 100) / 100;
    const locality = cleanString(row.locality);
    const village = cleanString(row.headings.village);
    const road = cleanString(row.road);
    if (!locality && !village && !road) continue;

    const page = Number(row.page);
    if (contextPage !== null && page === contextPage) continue;
    const out: ParsedRateRow = {
      property_class: propertyClass,
      ...(landClass ? { land_class: landClass } : {}),
      rate,
      unit,
      page:
        Number.isInteger(page) && page >= fromPage && page <= toPage
          ? page
          : fromPage,
    };
    for (const key of ['district', 'taluk', 'hobli'] as const) {
      const value = cleanString(row.headings[key]);
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

interface RatePagesInput {
  buffer: Uint8Array;
  fromPage: number;
  toPage: number;
  headings?: RateHeadings | null;
  unit?: AreaUnit | null;
}

type RatePagesResult = { rows: ParsedRateRow[]; totalPages: number | null };

export async function parseRatePages(
  input: RatePagesInput
): Promise<RatePagesResult> {
  const signal = AbortSignal.timeout(RATE_READ_TIMEOUT_MS);
  try {
    return await readRatePages(input, signal);
  } catch (err) {
    if (
      !(signal.aborted || isOutputCutOff(err)) ||
      input.toPage <= input.fromPage
    ) {
      throw err;
    }
  }
  const rows: ParsedRateRow[] = [];
  let totalPages: number | null = null;
  let headings = input.headings;
  for (let page = input.fromPage; page <= input.toPage; page += 1) {
    const result = await readRatePages(
      { ...input, fromPage: page, toPage: page, headings },
      AbortSignal.timeout(RATE_READ_TIMEOUT_MS)
    );
    rows.push(...result.rows);
    totalPages = result.totalPages ?? totalPages;
    headings = result.rows.at(-1) ?? headings;
  }
  return { rows, totalPages };
}

async function readRatePages(
  input: RatePagesInput,
  signal: AbortSignal
): Promise<RatePagesResult> {
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
    rateInstructions(
      input.fromPage,
      input.toPage,
      slice,
      input.headings,
      input.unit
    ),
    {
      feature: 'guidance_value_source_parse',
      tier: rateParseTier(),
      keyScope: 'import',
      signal,
      maxOutputTokens: RATE_MAX_OUTPUT_TOKENS,
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
