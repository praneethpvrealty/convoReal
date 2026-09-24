import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { extractEKhata } from '@/lib/inventory/e-khata';
import {
  E_KHATA_MAX_BYTES,
  isEKhataMimeType,
  isReadableEKhata,
} from '@/lib/inventory/e-khata-fields';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'property-documents';
const FEATURE = 'listing_parse';
const COST = AI_FEATURE_COSTS[FEATURE];

// POST /api/properties/e-khata
//
// Reads an e-Khata the caller has already uploaded to property-documents
// and PROPOSES listing fields; the web form and the mobile editor apply
// them one by one. With property_id the file is also attached to that
// listing's documents, which is how the mobile editor keeps it.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `eKhataRead:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      path?: unknown;
      mime_type?: unknown;
      property_id?: unknown;
    } | null;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const mimeType =
      typeof body?.mime_type === 'string' ? body.mime_type.toLowerCase() : '';
    const propertyId =
      typeof body?.property_id === 'string' ? body.property_id : null;

    if (
      !path.startsWith(`${BUCKET}/${ctx.accountId}/`) ||
      path.includes('..')
    ) {
      return NextResponse.json(
        { error: 'Upload the e-Khata first.' },
        { status: 400 }
      );
    }
    if (!isEKhataMimeType(mimeType)) {
      return NextResponse.json(
        {
          error: 'Only a PDF or a JPEG, PNG or WebP photo can be read.',
          code: 'UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }

    let documents: string[] | null = null;
    if (propertyId) {
      const { data: property } = await ctx.supabase
        .from('properties')
        .select('id, documents')
        .eq('id', propertyId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!property) {
        return NextResponse.json(
          { error: 'Property not found' },
          { status: 404 }
        );
      }
      documents = (property.documents as string[] | null) ?? [];
    }

    const { data: file, error: downloadError } = await supabaseAdmin()
      .storage.from(BUCKET)
      .download(path.slice(BUCKET.length + 1));
    if (downloadError || !file) {
      return NextResponse.json(
        { error: 'Could not find the uploaded e-Khata.' },
        { status: 404 }
      );
    }
    if (file.size > E_KHATA_MAX_BYTES) {
      return NextResponse.json(
        { error: 'An e-Khata is a page or two; this file is too large.' },
        { status: 413 }
      );
    }

    const burn = await burnCredits(ctx.accountId, FEATURE, COST);
    if (!burn.success) {
      return NextResponse.json(
        {
          error: `Not enough credits to read this e-Khata. ${burn.deficit} more needed.`,
          code: 'INSUFFICIENT_CREDITS',
        },
        { status: 402 }
      );
    }

    let fields;
    try {
      fields = await extractEKhata({
        buffer: new Uint8Array(await file.arrayBuffer()),
        mimeType,
      });
    } catch (err) {
      await refundCredits(ctx.accountId, FEATURE, COST, {
        description: 'e-Khata read failed',
      });
      console.error(
        '[e-khata] read failed:',
        err instanceof Error ? err.message : err
      );
      return NextResponse.json(
        { error: 'Could not read this e-Khata. Your credits were refunded.' },
        { status: 502 }
      );
    }

    if (!isReadableEKhata(fields)) {
      await refundCredits(ctx.accountId, FEATURE, COST, {
        description: 'not an e-Khata',
      });
      return NextResponse.json(
        {
          error:
            'This does not look like an e-Khata. Your credits were refunded.',
          code: 'NOT_E_KHATA',
        },
        { status: 422 }
      );
    }

    let attached = false;
    if (propertyId && documents) {
      const already = documents.some((doc) => doc.includes(path));
      if (!already) {
        const { data: updated, error } = await ctx.supabase
          .from('properties')
          .update({
            documents: [
              ...documents,
              JSON.stringify({ url: path, title: 'e-Khata' }),
            ],
          })
          .eq('id', propertyId)
          .eq('account_id', ctx.accountId)
          .select('id');
        attached = !error && (updated?.length ?? 0) > 0;
      }
    }

    return NextResponse.json({
      data: { fields, attached },
      credits: { spent: COST },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
