import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAiCall } from '@/lib/ai/call-log';
import { modelChain, OUTPUT_CUT_OFF } from '@/lib/ai/gemini';
import {
  classifyGeminiKeyFailure,
  isRetiredModelMessage,
  markModelRetired,
  resolveGeminiKeys,
  usableModels,
  withGeminiKeys,
  type GeminiKey,
} from '@/lib/ai/gemini-keys';
import { parseJsonResponse } from '@/lib/invoices/document-extract';

import { rateDistrict } from './districts';
import { pageTexts, planSkippedPages, skippedRunEnd } from './page-filter';
import {
  PAGES_PER_CHUNK,
  countPdfPages,
  rateInstructions,
  rateParseTier,
  sanitiseRateRows,
  openPdf,
  slicePdf,
  RATE_MAX_OUTPUT_TOKENS,
} from './rate-parse';
import { GUIDANCE_SOURCE_BUCKET } from './server';
import type { ParsedRateRow } from './types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const BATCH_FEATURE = 'guidance_value_source_batch';
export const BATCH_MAX_BYTES = 15 * 1024 * 1024;
export const BATCH_BUILD_BUDGET_MS = 200_000;
export const CRON_BUILD_BUDGET_MS = 120_000;
export const CRON_DEADLINE_MS = 240_000;
export const CRON_MIN_QUEUE_MS = 15_000;
const APPLYING_STALE_MS = 15 * 60_000;
const UNSUBMITTED_PREFIX = 'unsubmitted:';
const UNSUBMITTED_STALE_MS = 30 * 60_000;

export interface BatchChunk {
  source_id: string;
  from_page: number;
  to_page: number;
  context_page: number | null;
  skipped?: boolean;
}

export interface BatchChunkResult {
  text: string | null;
  error: string | null;
  cutOff: boolean;
  promptTokens: number | null;
  responseTokens: number | null;
  thoughtTokens: number | null;
}

export type BatchState = 'running' | 'succeeded' | 'failed';

export interface BatchStatus {
  state: BatchState;
  error: string | null;
  results: BatchChunkResult[];
}

export interface PlannedChunk {
  from: number;
  to: number;
  skipped?: boolean;
}

export function planChunks(
  pageCount: number,
  pagesParsed: number,
  singlePages: number[] = [],
  skippedPages: boolean[] = []
): PlannedChunk[] {
  const singles = new Set(singlePages);
  const skipped = (page: number) => Boolean(skippedPages[page - 1]);
  const chunks: PlannedChunk[] = [];
  let from = pagesParsed + 1;
  while (from <= pageCount) {
    if (skipped(from)) {
      const to = skippedRunEnd(skippedPages, from);
      chunks.push({ from, to: Math.min(to, pageCount), skipped: true });
      from = to + 1;
      continue;
    }
    let to = Math.min(from + PAGES_PER_CHUNK - 1, pageCount);
    for (let page = from; page <= to; page += 1) {
      if (singles.has(page) || skipped(page)) to = Math.max(from, page - 1);
    }
    if (singles.has(from)) to = from;
    chunks.push({ from, to });
    from = to + 1;
  }
  return chunks;
}

export function batchRequest(
  bytes: Uint8Array,
  instructions: string,
  chunk: BatchChunk
): Record<string, unknown> {
  return {
    request: {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: Buffer.from(bytes).toString('base64'),
              },
            },
            {
              text: `Transcribe the guidance value rates on pages ${chunk.from_page} to ${chunk.to_page}.`,
            },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: instructions }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: RATE_MAX_OUTPUT_TOKENS,
      },
    },
    metadata: {
      key: `${chunk.source_id}:${chunk.from_page}-${chunk.to_page}`,
    },
  };
}

function errorText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message ? message : 'Request failed';
}

export function readBatchOperation(op: unknown): BatchStatus {
  const operation = (op ?? {}) as {
    done?: boolean;
    error?: unknown;
    metadata?: Record<string, unknown>;
    response?: Record<string, unknown>;
  };
  const batch = {
    ...(operation.response ?? {}),
    ...(operation.metadata ?? {}),
  };
  const state = String(batch.state ?? '');
  const opError = errorText(operation.error);
  if (
    opError ||
    state === 'BATCH_STATE_FAILED' ||
    state === 'BATCH_STATE_CANCELLED' ||
    state === 'BATCH_STATE_EXPIRED'
  ) {
    return {
      state: 'failed',
      error: opError ?? state.replace('BATCH_STATE_', '').toLowerCase(),
      results: [],
    };
  }
  if (state !== 'BATCH_STATE_SUCCEEDED') {
    return { state: 'running', error: null, results: [] };
  }
  const output = (batch.output ?? {}) as {
    inlinedResponses?: { inlinedResponses?: unknown[] };
  };
  const items = output.inlinedResponses?.inlinedResponses ?? [];
  return {
    state: 'succeeded',
    error: null,
    results: items.map((item) => {
      const entry = (item ?? {}) as {
        error?: unknown;
        response?: {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
            finishReason?: string;
          }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
          };
        };
      };
      const candidate = entry.response?.candidates?.[0];
      const cutOff = candidate?.finishReason === 'MAX_TOKENS';
      const text = cutOff
        ? null
        : candidate?.content?.parts?.map((part) => part.text ?? '').join('') ||
          null;
      return {
        text,
        error:
          errorText(entry.error) ??
          (cutOff ? OUTPUT_CUT_OFF : text ? null : 'No text returned'),
        cutOff,
        promptTokens: entry.response?.usageMetadata?.promptTokenCount ?? null,
        responseTokens:
          entry.response?.usageMetadata?.candidatesTokenCount ?? null,
        thoughtTokens:
          entry.response?.usageMetadata?.thoughtsTokenCount ?? null,
      };
    }),
  };
}

const HEADING_KEYS = ['district', 'taluk', 'hobli', 'village'] as const;

function sameHeading(a?: string, b?: string): boolean {
  const norm = (value?: string) =>
    (value ?? '')
      .toLowerCase()
      .replace(/\b(taluk|taluka|district|dist)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

export function assembleSourceRows(
  pagesParsed: number,
  chunks: Array<{ chunk: BatchChunk; rows: ParsedRateRow[] | null }>
): { rows: ParsedRateRow[]; parsedTo: number; failed: number } {
  const ordered = [...chunks].sort(
    (a, b) => a.chunk.from_page - b.chunk.from_page
  );
  const rows: ParsedRateRow[] = [];
  let parsedTo = pagesParsed;
  let contiguous = true;
  let failed = 0;
  let last: Partial<ParsedRateRow> = {};
  for (const { chunk, rows: chunkRows } of ordered) {
    if (!chunkRows) {
      failed += 1;
      contiguous = false;
      last = {};
      continue;
    }
    if (contiguous && chunk.from_page === parsedTo + 1)
      parsedTo = chunk.to_page;
    else contiguous = false;
    let ownHeadings = false;
    for (const row of chunkRows) {
      if (HEADING_KEYS.some((key) => row[key])) ownHeadings = true;
      const out = { ...row };
      if (!ownHeadings) {
        for (const key of HEADING_KEYS) {
          if (!out[key] && last[key]) out[key] = last[key];
        }
      } else if (!out.district || sameHeading(out.district, last.district)) {
        if (!out.taluk && last.taluk) out.taluk = last.taluk;
        if (!out.hobli && last.hobli && sameHeading(out.taluk, last.taluk)) {
          out.hobli = last.hobli;
        }
      }
      for (const key of HEADING_KEYS) last[key] = out[key];
      rows.push(out);
    }
  }
  return { rows, parsedTo, failed };
}

interface SourceForBatch {
  id: string;
  storage_path: string;
  page_count: number | null;
  pages_parsed: number;
  single_pages: number[] | null;
}

interface SkippedSource {
  code: 'SOURCE_NOT_STORED' | 'PAGE_COUNT_UNKNOWN' | 'DOWNLOAD_FAILED';
  error: string;
}

interface PreparedSource {
  source: SourceForBatch;
  pageCount: number;
  chunks: BatchChunk[];
  requests: Record<string, unknown>[];
  bytes: number;
}

async function isStored(
  db: SupabaseClient,
  storagePath: string
): Promise<boolean> {
  const slash = storagePath.lastIndexOf('/');
  const folder = slash >= 0 ? storagePath.slice(0, slash) : '';
  const name = storagePath.slice(slash + 1);
  const { data, error } = await db.storage
    .from(GUIDANCE_SOURCE_BUCKET)
    .list(folder, { search: name, limit: 10 });
  if (error) return true;
  return (data ?? []).some((entry) => entry.name === name);
}

async function prepareSource(
  db: SupabaseClient,
  source: SourceForBatch,
  room: number
): Promise<PreparedSource | SkippedSource> {
  const { data: file, error } = await db.storage
    .from(GUIDANCE_SOURCE_BUCKET)
    .download(source.storage_path);
  if (error || !file) {
    if (
      source.pages_parsed === 0 &&
      !(await isStored(db, source.storage_path))
    ) {
      return {
        code: 'SOURCE_NOT_STORED',
        error: 'The PDF for this notification never finished uploading.',
      };
    }
    return {
      code: 'DOWNLOAD_FAILED',
      error: `The stored PDF could not be read (${error?.message ?? 'empty download'}); the next run retries it.`,
    };
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await openPdf(buffer);
  const pageCount =
    source.page_count ?? pdf?.getPageCount() ?? countPdfPages(buffer);
  if (!pageCount) {
    return {
      code: 'PAGE_COUNT_UNKNOWN',
      error:
        'Could not tell how many pages this PDF has. Enter the page count.',
    };
  }
  const prepared: PreparedSource = {
    source,
    pageCount,
    chunks: [],
    requests: [],
    bytes: 0,
  };
  const skippedPages = pdf ? planSkippedPages(pageTexts(pdf)) : [];
  for (const { from, to, skipped } of planChunks(
    pageCount,
    source.pages_parsed,
    source.single_pages ?? [],
    skippedPages
  )) {
    if (skipped) {
      prepared.chunks.push({
        source_id: source.id,
        from_page: from,
        to_page: to,
        context_page: null,
        skipped: true,
      });
      continue;
    }
    const slice = pdf ? await slicePdf(pdf, from, to) : null;
    const bytes = slice?.bytes ?? buffer;
    const size = Math.ceil((bytes.byteLength * 4) / 3) + 8_000;
    if (prepared.bytes + size > room && prepared.requests.length) break;
    const chunk: BatchChunk = {
      source_id: source.id,
      from_page: from,
      to_page: to,
      context_page: slice && slice.firstPage < from ? slice.firstPage : null,
    };
    prepared.chunks.push(chunk);
    prepared.requests.push(
      batchRequest(bytes, rateInstructions(from, to, slice), chunk)
    );
    prepared.bytes += size;
  }
  return prepared;
}

async function skipWithoutBatch(
  db: SupabaseClient,
  prepared: PreparedSource
): Promise<void> {
  const parsedTo = prepared.chunks[prepared.chunks.length - 1].to_page;
  const done = parsedTo >= prepared.pageCount;
  await db
    .from('guidance_value_sources')
    .update({
      pages_parsed: parsedTo,
      status: done ? 'ready' : 'parsing',
      error: null,
      ...(done ? { batch_requested_at: null } : {}),
    })
    .eq('id', prepared.source.id)
    .is('batch_id', null)
    .select('id');
}

async function createRemoteBatch(
  requests: Record<string, unknown>[]
): Promise<{ name: string; model: string; key: GeminiKey }> {
  return withGeminiKeys({ scope: 'import' }, async (key) => {
    let lastError: Error | null = null;
    for (const model of usableModels(key, modelChain(rateParseTier()))) {
      const res = await fetch(
        `${API_BASE}/models/${model}:batchGenerateContent?key=${encodeURIComponent(key.key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch: {
              displayName: `guidance-values-${Date.now()}`,
              inputConfig: { requests: { requests } },
            },
          }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body?.name === 'string') {
        return { name: body.name as string, model, key };
      }
      const message =
        body?.error?.message || `Gemini batch create failed (${res.status})`;
      lastError = new Error(message);
      if (isRetiredModelMessage(message)) {
        markModelRetired(key, model);
        continue;
      }
      throw lastError;
    }
    throw lastError ?? new Error('No Gemini model accepted the batch.');
  });
}

export interface QueueResult {
  batches: number;
  sources: number;
  requests: number;
  remaining: number;
  skipped: Array<{ source_id: string } & SkippedSource>;
}

export async function queueGuidanceBatches(
  db: SupabaseClient,
  now: () => number = Date.now,
  opts: { requestedOnly?: boolean; budgetMs?: number } = {}
): Promise<QueueResult> {
  const startedAt = now();
  const budgetMs = opts.budgetMs ?? BATCH_BUILD_BUDGET_MS;
  if (!opts.requestedOnly) {
    const { error: requestError } = await db
      .from('guidance_value_sources')
      .update({ batch_requested_at: new Date(startedAt).toISOString() })
      .in('status', ['uploaded', 'parsing', 'failed'])
      .is('batch_id', null)
      .is('batch_requested_at', null)
      .select('id');
    if (requestError) throw new Error(requestError.message);
  }
  let select = db
    .from('guidance_value_sources')
    .select('id, storage_path, page_count, pages_parsed, single_pages')
    .in('status', ['uploaded', 'parsing', 'failed'])
    .is('batch_id', null);
  if (opts.requestedOnly) select = select.not('batch_requested_at', 'is', null);
  const { data, error } = await select
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const queue = [...((data ?? []) as SourceForBatch[])];
  const result: QueueResult = {
    batches: 0,
    sources: 0,
    requests: 0,
    remaining: 0,
    skipped: [],
  };

  let pending: PreparedSource[] = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (!pending.length) return;
    const batching = pending;
    pending = [];
    pendingBytes = 0;
    const { data: batch, error: insertError } = await db
      .from('guidance_value_batches')
      .insert({
        gemini_name: `${UNSUBMITTED_PREFIX}${randomUUID()}`,
        key_label: '',
        model: '',
        chunks: [],
        request_count: 0,
      })
      .select('id')
      .single<{ id: string }>();
    if (insertError || !batch) {
      throw new Error(insertError?.message ?? 'Could not record the batch.');
    }
    const discard = () =>
      db.from('guidance_value_batches').delete().eq('id', batch.id);
    const claimed: PreparedSource[] = [];
    for (const prepared of batching) {
      const { data: won, error: claimError } = await db
        .from('guidance_value_sources')
        .update({
          batch_id: batch.id,
          status: 'parsing',
          error: null,
          page_count: prepared.pageCount,
        })
        .eq('id', prepared.source.id)
        .is('batch_id', null)
        .select('id');
      if (claimError) {
        await discard();
        throw new Error(claimError.message);
      }
      if (won?.length) claimed.push(prepared);
    }
    if (!claimed.length) {
      await discard();
      return;
    }
    const requests = claimed.flatMap((p) => p.requests);
    const chunks = claimed.flatMap((p) => p.chunks);
    let remote: Awaited<ReturnType<typeof createRemoteBatch>>;
    try {
      remote = await createRemoteBatch(requests);
    } catch (err) {
      await discard();
      throw err;
    }
    const { error: recordError } = await db
      .from('guidance_value_batches')
      .update({
        gemini_name: remote.name,
        key_id: remote.key.id,
        key_label: remote.key.label,
        model: remote.model,
        chunks,
        request_count: requests.length,
      })
      .eq('id', batch.id)
      .select('id');
    if (recordError) throw new Error(recordError.message);
    result.batches += 1;
    result.sources += claimed.length;
    result.requests += requests.length;
  };

  while (queue.length) {
    if (now() - startedAt > budgetMs) break;
    const source = queue.shift()!;
    const prepared = await prepareSource(
      db,
      source,
      BATCH_MAX_BYTES - pendingBytes
    );
    if ('error' in prepared) {
      if (prepared.code !== 'DOWNLOAD_FAILED') {
        await db
          .from('guidance_value_sources')
          .update({
            status: 'failed',
            error: prepared.error,
            batch_requested_at: null,
          })
          .eq('id', source.id)
          .is('batch_id', null)
          .select('id');
      }
      result.skipped.push({
        source_id: source.id,
        code: prepared.code,
        error: prepared.error,
      });
      continue;
    }
    if (!prepared.requests.length) {
      if (prepared.chunks.length) await skipWithoutBatch(db, prepared);
      continue;
    }
    if (pendingBytes + prepared.bytes > BATCH_MAX_BYTES && pending.length) {
      await flush();
      queue.unshift(source);
      continue;
    }
    pending.push(prepared);
    pendingBytes += prepared.bytes;
  }
  await flush();
  result.remaining = queue.length;
  return result;
}

interface BatchRow {
  id: string;
  gemini_name: string;
  key_id: string | null;
  key_label: string;
  model: string;
  state: string;
  chunks: BatchChunk[];
  updated_at: string;
}

async function keyFor(row: BatchRow): Promise<GeminiKey | null> {
  const pool = await resolveGeminiKeys({ scope: 'import' });
  return (
    pool.find((key) => row.key_id && key.id === row.key_id) ??
    pool.find((key) => key.label === row.key_label) ??
    null
  );
}

async function fetchBatchStatus(
  row: BatchRow,
  key: GeminiKey
): Promise<BatchStatus> {
  const res = await fetch(
    `${API_BASE}/${row.gemini_name}?key=${encodeURIComponent(key.key)}`
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      body?.error?.message || `Gemini batch lookup failed (${res.status})`;
    if (res.status === 404)
      return { state: 'failed', error: message, results: [] };
    throw new Error(message);
  }
  return readBatchOperation(body);
}

async function finishBatch(
  db: SupabaseClient,
  row: BatchRow,
  patch: Record<string, unknown>,
  sourcePatch: Record<string, unknown> = {}
): Promise<void> {
  await db
    .from('guidance_value_sources')
    .update({
      ...sourcePatch,
      ...(patch.state === 'failed' ? { batch_requested_at: null } : {}),
      batch_id: null,
    })
    .eq('batch_id', row.id)
    .select('id');
  await db
    .from('guidance_value_batches')
    .update(patch)
    .eq('id', row.id)
    .select('id');
}

async function applyResults(
  db: SupabaseClient,
  row: BatchRow,
  results: BatchChunkResult[]
): Promise<number> {
  const bySource = new Map<
    string,
    Array<{ chunk: BatchChunk; rows: ParsedRateRow[] | null; cutOff: boolean }>
  >();
  let failedCount = 0;
  let requestIndex = 0;
  row.chunks.forEach((chunk) => {
    if (chunk.skipped) {
      const list = bySource.get(chunk.source_id) ?? [];
      list.push({ chunk, rows: [], cutOff: false });
      bySource.set(chunk.source_id, list);
      return;
    }
    const result = results[requestIndex];
    requestIndex += 1;
    let rows: ParsedRateRow[] | null = null;
    if (result?.text) {
      try {
        rows = sanitiseRateRows(
          parseJsonResponse(result.text),
          chunk.from_page,
          chunk.to_page,
          chunk.context_page
        ).rows;
      } catch {
        rows = null;
      }
    }
    if (!rows) failedCount += 1;
    logAiCall({
      keyLabel: row.key_label,
      feature: BATCH_FEATURE,
      model: row.model,
      tier: rateParseTier(),
      success: Boolean(rows),
      errorMessage: rows ? undefined : (result?.error ?? 'Unreadable response'),
      latencyMs: 0,
      jsonMode: true,
      hasMedia: true,
      promptTokens: result?.promptTokens ?? null,
      responseTokens: result?.responseTokens ?? null,
      thoughtTokens: result?.thoughtTokens ?? null,
      promptChars: 0,
      responseChars: result?.text?.length ?? 0,
    });
    const list = bySource.get(chunk.source_id) ?? [];
    list.push({ chunk, rows, cutOff: Boolean(result?.cutOff) });
    bySource.set(chunk.source_id, list);
  });

  for (const [sourceId, chunks] of bySource) {
    const { data: source } = await db
      .from('guidance_value_sources')
      .select('id, district, taluk, page_count, pages_parsed, single_pages')
      .eq('id', sourceId)
      .maybeSingle<{
        id: string;
        district: string;
        taluk: string | null;
        page_count: number | null;
        pages_parsed: number;
        single_pages: number[] | null;
      }>();
    if (!source) continue;
    const assembled = assembleSourceRows(source.pages_parsed, chunks);
    const singlePages = new Set(source.single_pages ?? []);
    let stuckPage: number | null = null;
    for (const { chunk, cutOff } of chunks) {
      if (!cutOff) continue;
      if (chunk.from_page === chunk.to_page) stuckPage ??= chunk.from_page;
      for (let page = chunk.from_page; page <= chunk.to_page; page += 1) {
        singlePages.add(page);
      }
    }
    for (const { chunk, rows } of chunks) {
      if (!rows) continue;
      const { error: deleteError } = await db
        .from('guidance_value_rates')
        .delete()
        .eq('source_id', sourceId)
        .gte('page', chunk.from_page)
        .lte('page', chunk.to_page);
      if (deleteError) throw new Error(deleteError.message);
    }
    if (assembled.rows.length) {
      const { error: insertError } = await db
        .from('guidance_value_rates')
        .insert(
          assembled.rows.map((rate) => ({
            ...rate,
            source_id: sourceId,
            district: rateDistrict(rate.district, source.district),
            taluk: rate.taluk ?? source.taluk,
          }))
        );
      if (insertError) throw new Error(insertError.message);
    }
    const { count } = await db
      .from('guidance_value_rates')
      .select('id', { head: true, count: 'exact' })
      .eq('source_id', sourceId);
    const pageCount = source.page_count ?? assembled.parsedTo;
    const done = assembled.parsedTo >= pageCount;
    await db
      .from('guidance_value_sources')
      .update({
        batch_id: null,
        pages_parsed: assembled.parsedTo,
        row_count: count ?? 0,
        single_pages: [...singlePages].sort((a, b) => a - b),
        status: done ? 'ready' : stuckPage ? 'failed' : 'parsing',
        ...(done || stuckPage || assembled.parsedTo <= source.pages_parsed
          ? { batch_requested_at: null }
          : {}),
        error: stuckPage
          ? `Page ${stuckPage} produces more output than the reader allows; it cannot be read in a batch.`
          : assembled.failed
            ? `${assembled.failed} page range(s) could not be read in the batch; the next run retries them.`
            : null,
      })
      .eq('id', sourceId)
      .select('id');
  }
  return failedCount;
}

export interface PollResult {
  checked: number;
  applied: number;
  failed: number;
  running: number;
}

export function cronQueueBudgetMs(startedAt: number, now: number): number {
  return Math.min(CRON_BUILD_BUDGET_MS, startedAt + CRON_DEADLINE_MS - now);
}

export async function pollGuidanceBatches(
  db: SupabaseClient,
  now: () => number = Date.now
): Promise<PollResult> {
  const { data, error } = await db
    .from('guidance_value_batches')
    .select(
      'id, gemini_name, key_id, key_label, model, state, chunks, updated_at'
    )
    .in('state', ['pending', 'applying'])
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  const result: PollResult = { checked: 0, applied: 0, failed: 0, running: 0 };

  for (const row of (data ?? []) as BatchRow[]) {
    if (row.gemini_name.startsWith(UNSUBMITTED_PREFIX)) {
      if (now() - new Date(row.updated_at).getTime() > UNSUBMITTED_STALE_MS) {
        await db
          .from('guidance_value_batches')
          .delete()
          .eq('id', row.id)
          .eq('gemini_name', row.gemini_name);
      }
      continue;
    }
    if (
      row.state === 'applying' &&
      now() - new Date(row.updated_at).getTime() < APPLYING_STALE_MS
    ) {
      result.running += 1;
      continue;
    }
    result.checked += 1;
    const key = await keyFor(row);
    if (!key) {
      await finishBatch(db, row, {
        state: 'failed',
        error: `The key "${row.key_label}" that submitted this batch is gone.`,
      });
      result.failed += 1;
      continue;
    }
    let status: BatchStatus;
    try {
      status = await fetchBatchStatus(row, key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (classifyGeminiKeyFailure(message)) {
        result.running += 1;
        continue;
      }
      throw err;
    }
    if (status.state === 'running') {
      result.running += 1;
      continue;
    }
    if (status.state === 'failed') {
      await finishBatch(
        db,
        row,
        {
          state: 'failed',
          error: (status.error ?? 'Batch failed').slice(0, 500),
        },
        {
          error:
            `The Gemini batch ${status.error ?? 'failed'}; queue it again to retry.`.slice(
              0,
              500
            ),
        }
      );
      result.failed += 1;
      continue;
    }
    const { data: claimed } = await db
      .from('guidance_value_batches')
      .update({ state: 'applying' })
      .eq('id', row.id)
      .in('state', ['pending', 'applying'])
      .eq('updated_at', row.updated_at)
      .select('id');
    if (!claimed?.length) {
      result.running += 1;
      continue;
    }
    try {
      const failedCount = await applyResults(db, row, status.results);
      await finishBatch(db, row, {
        state: 'applied',
        failed_count: failedCount,
        applied_at: new Date(now()).toISOString(),
      });
      result.applied += 1;
    } catch (err) {
      await db
        .from('guidance_value_batches')
        .update({
          state: 'pending',
          error: (err instanceof Error ? err.message : String(err)).slice(
            0,
            500
          ),
        })
        .eq('id', row.id)
        .select('id');
      throw err;
    }
  }
  return result;
}
