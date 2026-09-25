import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ForbiddenError,
  UnauthorizedError,
  getCurrentAccount,
  type AccountContext,
} from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { rateDistrict } from './districts';
import {
  pageTexts,
  planSkippedPages,
  printedAreaUnit,
  settleUnits,
  skippedRunEnd,
} from './page-filter';
import {
  districtPattern,
  desiredClass,
  placeKey,
  rankMatches,
  searchQueries,
} from './match';
import {
  PAGES_PER_CHUNK,
  countPdfPages,
  classifyAiOutage,
  openPdf,
  parseRatePages,
  type RateHeadings,
} from './rate-parse';
import type {
  GuidanceRate,
  LookupResult,
  PropertyClass,
  PropertySchedule,
  AreaUnit,
  LandClass,
  ValuationOptions,
} from './types';

export const GUIDANCE_SOURCE_BUCKET = 'guidance-value-sources';

export class SourceNotStoredError extends Error {
  readonly code = 'SOURCE_NOT_STORED' as const;
  constructor() {
    super('The PDF for this notification never finished uploading.');
    this.name = 'SourceNotStoredError';
  }
}

export class SourceInBatchError extends Error {
  readonly code = 'SOURCE_IN_BATCH' as const;
  constructor() {
    super(
      'This notification is queued in a half-price batch; its rates arrive when the batch finishes.'
    );
    this.name = 'SourceInBatchError';
  }
}

export class AiUnavailableError extends Error {
  readonly code: 'AI_UNAVAILABLE' | 'AI_RATE_LIMITED';
  constructor(message: string, rateLimited: boolean) {
    super(message);
    this.name = 'AiUnavailableError';
    this.code = rateLimited ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE';
  }
}

export type GuidanceCaller =
  | { kind: 'staff'; userId: string; ctx: AccountContext }
  | { kind: 'portal'; userId: string };

export async function resolveGuidanceCaller(): Promise<GuidanceCaller> {
  try {
    const ctx = await getCurrentAccount();
    return { kind: 'staff', userId: ctx.userId, ctx };
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const db = supabaseAdmin();
  const [buyer, den] = await Promise.all([
    db
      .from('buyer_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle(),
    db.from('den_users').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ]);
  if (!buyer.data && !den.data) {
    throw new ForbiddenError(
      'Verify your WhatsApp number to use the guidance value tool.'
    );
  }
  return { kind: 'portal', userId: user.id };
}

export async function requireGuidanceAdmin(): Promise<{ userId: string }> {
  return requirePlatformAdmin();
}

interface RateRow {
  id: string;
  source_id: string;
  district: string | null;
  taluk: string | null;
  hobli: string | null;
  village: string | null;
  locality: string | null;
  road: string | null;
  survey_numbers: string | null;
  property_class: string;
  land_class?: string | null;
  rate: number | string;
  unit: string;
  page: number | null;
  source_title: string | null;
  effective_from: string | null;
  similarity: number | null;
}

function toRate(row: RateRow): GuidanceRate {
  return {
    id: row.id,
    source_id: row.source_id,
    district: row.district,
    taluk: row.taluk,
    hobli: row.hobli,
    village: row.village,
    locality: row.locality,
    road: row.road,
    survey_numbers: row.survey_numbers,
    property_class: row.property_class as PropertyClass,
    land_class: (row.land_class ?? null) as LandClass | null,
    rate: Number(row.rate),
    unit: row.unit as AreaUnit,
    page: row.page,
    source_title: row.source_title,
    effective_from: row.effective_from,
    similarity: row.similarity ?? undefined,
  };
}

async function searchRates(
  db: SupabaseClient,
  query: string,
  pattern: string | null
): Promise<RateRow[]> {
  const { data, error } = await db.rpc('search_guidance_value_rates', {
    p_query: query,
    p_district_pattern: pattern,
    p_limit: 80,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RateRow[];
}

async function searchRatesBySpelling(
  db: SupabaseClient,
  key: string,
  pattern: string
): Promise<RateRow[]> {
  const { data, error } = await db.rpc('search_guidance_value_rates_by_key', {
    p_key: key,
    p_district_pattern: pattern,
    p_limit: 80,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RateRow[];
}

export async function findCandidateRates(
  db: SupabaseClient,
  schedule: PropertySchedule
): Promise<GuidanceRate[]> {
  const pattern = districtPattern(schedule);
  const byId = new Map<string, GuidanceRate>();
  for (const query of searchQueries(schedule)) {
    const rows = await searchRates(db, query, pattern);
    for (const row of rows) byId.set(row.id, toRate(row));
  }
  const key = placeKey(schedule.village);
  if (pattern && key.length >= 3) {
    for (const row of await searchRatesBySpelling(db, key, pattern)) {
      byId.set(row.id, toRate(row));
    }
  }
  return [...byId.values()];
}

async function hasRatesFor(
  db: SupabaseClient,
  schedule: PropertySchedule
): Promise<boolean> {
  let query = db
    .from('guidance_value_sources')
    .select('id', { head: true, count: 'exact' })
    .in('status', ['parsing', 'ready']);
  const pattern = districtPattern(schedule);
  if (pattern) query = query.filter('district', 'imatch', pattern);
  const { count } = await query;
  return (count ?? 0) > 0;
}

export async function lookupGuidanceValue(
  db: SupabaseClient,
  schedule: PropertySchedule,
  options: ValuationOptions = {}
): Promise<LookupResult> {
  const rates = await findCandidateRates(db, schedule);
  const matches = rankMatches(schedule, rates, options);
  const coverage = matches.length
    ? 'matched'
    : (await hasRatesFor(db, schedule))
      ? 'no_match'
      : 'no_rates';
  return {
    schedule,
    desired_class: desiredClass(schedule),
    matches,
    coverage,
  };
}

export interface GuidanceSourceRow {
  id: string;
  state_code: string;
  district: string;
  taluk: string | null;
  sro: string | null;
  title: string;
  effective_from: string | null;
  storage_path: string;
  source_url: string | null;
  page_count: number | null;
  pages_parsed: number;
  row_count: number;
  status: 'uploaded' | 'parsing' | 'ready' | 'failed';
  batch_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const SOURCE_COLUMNS =
  'id, state_code, district, taluk, sro, title, effective_from, storage_path, source_url, page_count, pages_parsed, row_count, status, batch_id, error, created_at, updated_at';

export async function parseNextSourceChunk(
  db: SupabaseClient,
  sourceId: string
): Promise<GuidanceSourceRow> {
  const { data: source, error } = await db
    .from('guidance_value_sources')
    .select(SOURCE_COLUMNS)
    .eq('id', sourceId)
    .maybeSingle<GuidanceSourceRow>();
  if (error) throw new Error(error.message);
  if (!source) throw new Error('Source not found');
  if (source.status === 'ready') return source;
  if (source.batch_id) throw new SourceInBatchError();

  try {
    const { data: file, error: downloadError } = await db.storage
      .from(GUIDANCE_SOURCE_BUCKET)
      .download(source.storage_path);
    if (downloadError || !file) {
      if (source.pages_parsed === 0) {
        throw new SourceNotStoredError();
      }
      throw new Error(
        downloadError?.message ?? 'Could not read the stored PDF.'
      );
    }
    const buffer = new Uint8Array(await file.arrayBuffer());

    const pdf = await openPdf(buffer);
    const knownPages =
      source.page_count ?? pdf?.getPageCount() ?? countPdfPages(buffer);
    const fromPage = source.pages_parsed + 1;
    const texts = pdf ? pageTexts(pdf) : [];
    const skippedPages = planSkippedPages(texts);
    if (skippedPages[fromPage - 1]) {
      const parsedTo = Math.min(
        skippedRunEnd(skippedPages, fromPage),
        knownPages ?? Number.MAX_SAFE_INTEGER
      );
      const done = knownPages !== null && parsedTo >= knownPages;
      const { data: skipped, error: skipError } = await db
        .from('guidance_value_sources')
        .update({
          pages_parsed: parsedTo,
          page_count: knownPages,
          status: done ? 'ready' : 'parsing',
          error: null,
          ...(done ? { batch_requested_at: null } : {}),
        })
        .eq('id', source.id)
        .select(SOURCE_COLUMNS)
        .single<GuidanceSourceRow>();
      if (skipError) throw new Error(skipError.message);
      return skipped;
    }
    let toPage = knownPages
      ? Math.min(fromPage + PAGES_PER_CHUNK - 1, knownPages)
      : fromPage + PAGES_PER_CHUNK - 1;
    if (skippedPages[toPage - 1]) toPage = fromPage;

    const { data: headings } = await db
      .from('guidance_value_rates')
      .select('district, taluk, hobli, village, locality')
      .eq('source_id', source.id)
      .lt('page', fromPage)
      .order('page', { ascending: false })
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle<RateHeadings>();

    const { rows, totalPages } = await parseRatePages({
      buffer,
      fromPage,
      toPage,
      headings,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const outage = classifyAiOutage(message);
      if (outage) {
        throw new AiUnavailableError(message, outage === 'rate_limited');
      }
      throw err;
    });
    const pageCount = knownPages ?? totalPages;
    if (!pageCount) {
      throw new Error(
        'Could not tell how many pages this PDF has. Enter the page count.'
      );
    }

    await db
      .from('guidance_value_rates')
      .delete()
      .eq('source_id', source.id)
      .gte('page', fromPage)
      .lte('page', toPage);

    if (rows.length) {
      const { error: insertError } = await db
        .from('guidance_value_rates')
        .insert(
          settleUnits(rows, printedAreaUnit(texts)).map((row) => ({
            ...row,
            source_id: source.id,
            district: rateDistrict(row.district, source.district),
            taluk: row.taluk ?? source.taluk,
          }))
        );
      if (insertError) throw new Error(insertError.message);
    }

    const { count } = await db
      .from('guidance_value_rates')
      .select('id', { head: true, count: 'exact' })
      .eq('source_id', source.id);

    const parsedTo = Math.min(toPage, pageCount);
    const { data: updated, error: updateError } = await db
      .from('guidance_value_sources')
      .update({
        page_count: pageCount,
        pages_parsed: parsedTo,
        row_count: count ?? 0,
        status: parsedTo >= pageCount ? 'ready' : 'parsing',
        error: null,
      })
      .eq('id', source.id)
      .select(SOURCE_COLUMNS)
      .single<GuidanceSourceRow>();
    if (updateError) throw new Error(updateError.message);
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof AiUnavailableError) {
      await db
        .from('guidance_value_sources')
        .update({ error: message.slice(0, 500) })
        .eq('id', source.id);
      throw err;
    }
    await db
      .from('guidance_value_sources')
      .update({ status: 'failed', error: message.slice(0, 500) })
      .eq('id', source.id);
    throw err;
  }
}
