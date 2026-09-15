import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  getOrCreateInvoiceSettings,
  SIGNATURE_BUCKET,
  signedUrlFor,
} from '@/lib/invoices/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** A scanned signature is small; anything larger is the wrong file. */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

// GET /api/invoice-settings/signature
//
// A short-lived link to the stored signature, for the settings preview.
// The bucket is private and stays that way: a scanned signature is the
// one image in the product that must never be addressable by URL.
export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const settings = await getOrCreateInvoiceSettings(
      ctx.supabase,
      ctx.accountId
    );

    if (!settings.signature_image_path) {
      return NextResponse.json({ data: { url: null } });
    }

    const url = await signedUrlFor(
      SIGNATURE_BUCKET,
      settings.signature_image_path,
      300
    );
    return NextResponse.json({ data: { url } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/invoice-settings/signature — upload the scanned signature.
//
// Admin and above, like the rest of invoice settings: this image is
// what makes an invoice claim to be signed, so it sits at the same bar
// as the bank details.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `invoiceSignature:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json(
        {
          error: 'Upload a PNG, JPEG or WebP image.',
          code: 'UNSUPPORTED_TYPE',
        },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: 'The signature image must be under 2 MB.',
          code: 'FILE_TOO_LARGE',
        },
        { status: 413 }
      );
    }

    await getOrCreateInvoiceSettings(ctx.supabase, ctx.accountId);

    // One object per account at a fixed key, overwritten on re-upload:
    // there is only ever one current signature, and a timestamped name
    // would leave every superseded one lying in the bucket.
    const ext =
      file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'jpg';
    const objectPath = `${ctx.accountId}/signature.${ext}`;

    const { error: uploadError } = await supabaseAdmin()
      .storage.from(SIGNATURE_BUCKET)
      .upload(objectPath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: true,
        cacheControl: '0',
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 502 }
      );
    }

    const storagePath = `${SIGNATURE_BUCKET}/${objectPath}`;
    const { data, error } = await ctx.supabase
      .from('invoice_settings')
      .update({ signature_image_path: storagePath, signature_mode: 'image' })
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/invoice-settings/signature
//
// Clearing the image also drops the account out of image mode, because
// an invoice issued without one is not signed and should say so rather
// than silently printing an empty signature line.
export async function DELETE() {
  try {
    const ctx = await requireRole('admin');

    const settings = await getOrCreateInvoiceSettings(
      ctx.supabase,
      ctx.accountId
    );

    const { data, error } = await ctx.supabase
      .from('invoice_settings')
      .update({ signature_image_path: null, signature_mode: 'none' })
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (settings.signature_image_path?.startsWith(`${SIGNATURE_BUCKET}/`)) {
      await supabaseAdmin()
        .storage.from(SIGNATURE_BUCKET)
        .remove([
          settings.signature_image_path.slice(SIGNATURE_BUCKET.length + 1),
        ]);
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
