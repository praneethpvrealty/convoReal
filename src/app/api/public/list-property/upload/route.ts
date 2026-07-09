import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { uploadPropertyImage } from '@/lib/storage/upload';

// POST /api/public/list-property/upload  (multipart/form-data)
// Public photo upload for the seller listing funnel. Accepts a single
// image `file` and returns its stored public URL, which the submit
// route then accepts (it only trusts URLs on our storage host).
//
// Pre-verification, so kept cheap and bounded: image types only, size
// capped, and rate-limited per session + account. No AI, no DB writes
// beyond the storage object.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const SESSION_LIMIT = { limit: 30, windowMs: 60_000 };
const ACCOUNT_LIMIT = { limit: 200, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const accountId = String(form.get('account_id') || '');
    const sessionKey = String(form.get('session_key') || '').slice(0, 64);
    const file = form.get('file');

    if (!accountId || !UUID_RE.test(accountId)) {
      return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only image files are allowed.' }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large (max 8 MB).' }, { status: 413 });
    }

    if (sessionKey) {
      const s = checkRateLimit(`list-upload:session:${sessionKey}`, SESSION_LIMIT);
      if (!s.success) return rateLimitResponse(s);
    }
    const a = checkRateLimit(`list-upload:account:${accountId}`, ACCOUNT_LIMIT);
    if (!a.success) return rateLimitResponse(a);

    // Reject unknown/non-onboarded accounts — without this, the UUID
    // shape check alone lets anyone write capped-but-unbounded-count
    // images into an arbitrary account folder in our storage bucket.
    const { data: settings } = await supabaseAdmin()
      .from('showcase_settings')
      .select('account_id')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!settings) {
      return NextResponse.json({ error: 'This agent is not set up to receive listings yet.' }, { status: 409 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadPropertyImage(accountId, buffer, file.type);

    return NextResponse.json({ url });
  } catch (err) {
    console.error('[POST /api/public/list-property/upload] Unexpected error:', err);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
