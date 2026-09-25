import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import {
  IGR_GUIDANCE_PAGE,
  MAX_PAGE_BYTES,
  SourceFetchError,
  discoverFromHtml,
  discoverPdfs,
  downloadPdf,
  isAllowedSourceUrl,
} from '@/lib/guidance-value/import-url';
import {
  GUIDANCE_SOURCE_BUCKET,
  SOURCE_COLUMNS,
  requireGuidanceAdmin,
} from '@/lib/guidance-value/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 120;

const MAX_LINKS = 1000;

function text(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

// POST /api/admin/guidance-values/import
//
// `discover` lists the PDF links on an IGR page (or the link itself when
// it is a PDF); `import` downloads one PDF into storage and registers it
// as a source, ready for /sources/[id]/parse. Only https links on
// karnataka.gov.in are fetched, redirects included.
export async function POST(request: Request) {
  try {
    const { userId } = await requireGuidanceAdmin();
    const limit = await checkRateLimit(
      `guidanceImport:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const url = text(body?.url, 2000) ?? IGR_GUIDANCE_PAGE;
    const db = supabaseAdmin();

    try {
      if (body?.action === 'discover') {
        let found;
        if (typeof body?.html === 'string') {
          if (!isAllowedSourceUrl(url)) {
            return NextResponse.json(
              {
                error: 'Only https links on karnataka.gov.in can be imported.',
              },
              { status: 400 }
            );
          }
          if (body.html.length > MAX_PAGE_BYTES) {
            return NextResponse.json(
              { error: 'That page is too large to read.' },
              { status: 413 }
            );
          }
          found = discoverFromHtml(body.html, url);
        } else {
          found = await discoverPdfs(url);
        }
        const links = found.slice(0, MAX_LINKS);
        const { data: existing, error: existingError } = await db
          .from('guidance_value_sources')
          .select('id, source_url, status, row_count, batch_id')
          .not('source_url', 'is', null);
        if (existingError) throw new Error(existingError.message);
        const byUrl = new Map(
          (existing ?? []).map((row) => [row.source_url as string, row])
        );
        return NextResponse.json({
          data: links.map((link) => {
            const source = byUrl.get(link.url);
            return {
              ...link,
              imported: Boolean(source),
              source_id: (source?.id as string | undefined) ?? null,
              status: (source?.status as string | undefined) ?? null,
              row_count: (source?.row_count as number | undefined) ?? null,
              in_batch: Boolean(source?.batch_id),
            };
          }),
        });
      }

      if (body?.action !== 'import') {
        return NextResponse.json(
          { error: 'action must be discover or import' },
          { status: 400 }
        );
      }

      const district = text(body?.district);
      const title = text(body?.title, 200);
      if (!district || !title) {
        return NextResponse.json(
          { error: 'District and title are required' },
          { status: 400 }
        );
      }

      const { bytes, url: finalUrl } = await downloadPdf(url);
      const safeName = (
        decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() ?? '') ||
        'notification.pdf'
      )
        .replace(/[^a-zA-Z0-9.\-_]/g, '_')
        .slice(-120);
      const storagePath = `KA/${Date.now()}-${safeName}`;

      const { error: uploadError } = await db.storage
        .from(GUIDANCE_SOURCE_BUCKET)
        .upload(storagePath, bytes, { contentType: 'application/pdf' });
      if (uploadError) throw new Error(uploadError.message);

      const effectiveFrom = text(body?.effective_from, 10);
      const { data, error } = await db
        .from('guidance_value_sources')
        .insert({
          district,
          taluk: text(body?.taluk),
          sro: text(body?.sro),
          title,
          effective_from:
            effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
              ? effectiveFrom
              : null,
          storage_path: storagePath,
          source_url: url,
          uploaded_by: userId,
        })
        .select(SOURCE_COLUMNS)
        .single();
      if (error) {
        await db.storage.from(GUIDANCE_SOURCE_BUCKET).remove([storagePath]);
        throw new Error(error.message);
      }

      return NextResponse.json({ data }, { status: 201 });
    } catch (err) {
      if (err instanceof SourceFetchError) {
        console.error('[guidance-value] import refused:', url, err.message);
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        );
      }
      if (err instanceof Error && err.name === 'TimeoutError') {
        return NextResponse.json(
          { error: 'The site did not respond in time.' },
          { status: 504 }
        );
      }
      if (err instanceof TypeError) {
        const cause = (err as { cause?: { code?: string; message?: string } })
          .cause;
        const detail = cause?.code ?? cause?.message ?? err.message;
        console.error('[guidance-value] import fetch failed:', url, detail);
        return NextResponse.json(
          {
            error: `Could not reach the site (${detail}). It may block cloud servers — use the Guidance Value Import Chrome extension, or download the PDFs in your browser and use Upload many PDFs.`,
          },
          { status: 502 }
        );
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
