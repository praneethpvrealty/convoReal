import type { SupabaseClient } from '@supabase/supabase-js';

import { logAiCall } from '@/lib/ai/call-log';
import { modelChain } from '@/lib/ai/gemini';
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

import {
  PAGES_PER_CHUNK,
  countPdfPages,
  rateInstructions,
  rateParseTier,
  sanitiseRateRows,
  slicePdf,
} from './rate-parse';
import { GUIDANCE_SOURCE_BUCKET } from './server';
import type { ParsedRateRow } from './types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const BATCH_FEATURE = 'guidance_value_source_batch';
export const BATCH_MAX_BYTES = 15 * 1024 * 1024;
export const BATCH_BUILD_BUDGET_MS = 200_000;
const APPLYING_STALE_MS = 15 * 60_000;

export interface BatchChunk {
  source_id: string;
  from_page: number;
  to_page: number;
  context_page: number | null;
}

export interface BatchChunkResult {
  text: string | null;
  error: string | null;
  promptTokens: number | null;
  responseTokens: number | null;
}

export type BatchState = 'running' | 'succeeded' | 'failed';

export interface BatchStatus {
  state: BatchState;
  error: string | null;
  results: BatchChunkResult[];
}

export function planChunks(
  pageCount: number,
  pagesParsed: number
): Array<{ from: number; to: number }> {
  const chunks: Array<{ from: number; to: number }> = [];
  for (let from = pagesParsed + 1; from <= pageCount; from += PAGES_PER_CHUNK) {
    chunks.push({ from, to: Math.min(from + PAGES_PER_CHUNK - 1, pageCount) });
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
          }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
        };
      };
      const text =
        entry.response?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('') || null;
      return {
        text,
        error: errorText(entry.error) ?? (text ? null : 'No text returned'),
        promptTokens: entry.response?.usageMetadata?.promptTokenCount ?? null,
        responseTokens:
          entry.response?.usageMetadata?.candidatesTokenCount ?? null,
      };
    }),
  };
}

const HEADING_KEYS = ['district', 'taluk', 'hobli', 'village'] as const;

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
      if (row.village || row.hobli) ownHeadings = true;
      const out = { ...row };
      if (!ownHeadings) {
        for (const key of HEADING_KEYS) {
          if (!out[key] && last[key]) out[key] = last[key];
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
}

interface PreparedSource {
  source: SourceForBatch;
  pageCount: number;
  chunks: BatchChunk[];
  requests: Record<string, unknown>[];
  bytes: number;
}

async function prepareSource(
  db: SupabaseClient,
  source: SourceForBatch,
  room: number
): Promise<PreparedSource | { error: string }> {
  const { data: file, error } = await db.storage
    .from(GUIDANCE_SOURCE_BUCKET)
    .download(source.storage_path);
  if (error || !file) {
    return { error: 'The stored PDF could not be read. Upload it again.' };
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pageCount =
    source.page_count ??
    (await slicePdf(buffer, 1, 1))?.pageCount ??
    countPdfPages(buffer);
  if (!pageCount) {
    return {
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
  for (const { from, to } of planChunks(pageCount, source.pages_parsed)) {
    const slice = await slicePdf(buffer, from, to);
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
  skipped: Array<{ source_id: string; error: string }>;
}

export async function queueGuidanceBatches(
  db: SupabaseClient,
  now: () => number = Date.now
): Promise<QueueResult> {
  const startedAt = now();
  const { data, error } = await db
    .from('guidance_value_sources')
    .select('id, storage_path, page_count, pages_parsed')
    .in('status', ['uploaded', 'parsing', 'failed'])
    .is('batch_id', null)
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
    const requests = pending.flatMap((p) => p.requests);
    const chunks = pending.flatMap((p) => p.chunks);
    const remote = await createRemoteBatch(requests);
    const { data: batch, error: insertError } = await db
      .from('guidance_value_batches')
      .insert({
        gemini_name: remote.name,
        key_id: remote.key.id,
        key_label: remote.key.label,
        model: remote.model,
        chunks,
        request_count: requests.length,
      })
      .select('id')
      .single<{ id: string }>();
    if (insertError || !batch) {
      throw new Error(insertError?.message ?? 'Could not record the batch.');
    }
    for (const prepared of pending) {
      const { error: updateError } = await db
        .from('guidance_value_sources')
        .update({
          batch_id: batch.id,
          status: 'parsing',
          error: null,
          page_count: prepared.pageCount,
        })
        .eq('id', prepared.source.id)
        .select('id');
      if (updateError) throw new Error(updateError.message);
    }
    result.batches += 1;
    result.sources += pending.length;
    result.requests += requests.length;
    pending = [];
    pendingBytes = 0;
  };

  while (queue.length) {
    if (now() - startedAt > BATCH_BUILD_BUDGET_MS) break;
    const source = queue.shift()!;
    const prepared = await prepareSource(
      db,
      source,
      BATCH_MAX_BYTES - pendingBytes
    );
    if ('error' in prepared) {
      await db
        .from('guidance_value_sources')
        .update({ status: 'failed', error: prepared.error })
        .eq('id', source.id)
        .select('id');
      result.skipped.push({ source_id: source.id, error: prepared.error });
      continue;
    }
    if (!prepared.requests.length) continue;
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
    .update({ ...sourcePatch, batch_id: null })
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
    Array<{ chunk: BatchChunk; rows: ParsedRateRow[] | null }>
  >();
  let failedCount = 0;
  row.chunks.forEach((chunk, index) => {
    const result = results[index];
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
      promptChars: 0,
      responseChars: result?.text?.length ?? 0,
    });
    const list = bySource.get(chunk.source_id) ?? [];
    list.push({ chunk, rows });
    bySource.set(chunk.source_id, list);
  });

  for (const [sourceId, chunks] of bySource) {
    const { data: source } = await db
      .from('guidance_value_sources')
      .select('id, district, taluk, page_count, pages_parsed')
      .eq('id', sourceId)
      .maybeSingle<{
        id: string;
        district: string;
        taluk: string | null;
        page_count: number | null;
        pages_parsed: number;
      }>();
    if (!source) continue;
    const assembled = assembleSourceRows(source.pages_parsed, chunks);
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
            district: rate.district ?? source.district,
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
        status: done ? 'ready' : 'parsing',
        error: assembled.failed
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
