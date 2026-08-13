import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { storageObjectPath } from '@/lib/storage/url';
import { isGrantLive, type ShareGrant } from '@/lib/inventory/share-grants';
import { maskPhone } from '@/lib/inventory/location-guard';
import { watermarkImage, watermarkLabel } from '@/lib/storage/watermark';

const PRIVATE_BUCKET = 'property-images-private';
const GRANT_IMAGE_LIMIT = { limit: 60, windowMs: 60_000 };

// GET /api/public/share-grant/[token]/image/[index]
// Streams one guarded photo to the holder of a live share grant that
// opened them. The bucket has no public read policy, so the token is
// re-validated on every request — expiry and revocation take effect on
// the next image fetch, not merely on the next page render.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; index: string }> }
) {
  try {
    const { token, index } = await params;
    const i = Number.parseInt(index, 10);
    if (!token || token.length < 20 || !Number.isInteger(i) || i < 0) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const limit = await checkRateLimit(`shareGrantImage:${ip}`, GRANT_IMAGE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data } = await admin
      .from('property_share_grants')
      .select('*, property:properties(private_images), contact:contacts(phone)')
      .eq('token', token)
      .maybeSingle();

    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const grant = data as unknown as ShareGrant & {
      property:
        | { private_images?: string[] }
        | { private_images?: string[] }[]
        | null;
      contact: { phone?: string } | { phone?: string }[] | null;
    };

    if (!grant.reveal_private_images) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!isGrantLive(grant)) {
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }

    const property = (
      Array.isArray(grant.property) ? grant.property[0] : grant.property
    ) as { private_images?: string[] } | null;
    const list = Array.isArray(property?.private_images)
      ? property.private_images
      : [];
    const objectPath = storageObjectPath(list[i]);
    if (!objectPath || !objectPath.startsWith(`${PRIVATE_BUCKET}/`)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const key = objectPath.slice(PRIVATE_BUCKET.length + 1);
    const { data: file, error: downloadError } = await admin.storage
      .from(PRIVATE_BUCKET)
      .download(key);
    if (downloadError || !file) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Every guarded photo leaves here traceable to the key it was served
    // under, and — for a per-recipient grant — to the recipient.
    const contact = (
      Array.isArray(grant.contact) ? grant.contact[0] : grant.contact
    ) as { phone?: string } | null;
    const { buffer, contentType } = await watermarkImage(
      Buffer.from(await file.arrayBuffer()),
      watermarkLabel({
        viewerLabel: contact?.phone ? maskPhone(contact.phone) : null,
        reference: token.slice(0, 8).toUpperCase(),
      })
    );

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[GET public/share-grant image] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
