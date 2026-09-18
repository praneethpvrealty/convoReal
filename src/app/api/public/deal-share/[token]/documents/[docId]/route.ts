import { NextResponse } from 'next/server';

import { canStakeholderOpenDocument } from '@/lib/deals/external-view';
import { verifyUnlock } from '@/lib/deals/share-links';
import {
  clientIp,
  logShareAccess,
  resolveShareLink,
  unlockFromRequest,
} from '@/lib/deals/share-server';
import type { DealVisibility } from '@/lib/deals/visibility';
import { DEAL_DOCUMENT_BUCKET, signedUrlFor } from '@/lib/invoices/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { watermarkImage, watermarkLabel } from '@/lib/storage/watermark';
import { supabaseAdmin } from '@/lib/supabase/admin';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// GET /api/public/deal-share/[token]/documents/[docId]
//
// One document to one stakeholder. The link is re-validated, the OTP
// unlock re-checked, and the document's visibility re-applied through
// the same rule the view used — at the byte boundary, not the render.
// Photos are streamed with the stakeholder's name burned in; a PDF is
// handed over through a signed URL that dies in sixty seconds, since
// nothing in the stack can stamp an existing PDF.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; docId: string }> }
) {
  try {
    const { token, docId } = await params;
    const limit = await checkRateLimit(
      `dealShareDoc:${clientIp(request)}`,
      RATE_LIMITS.publicDealShare
    );
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const resolved = await resolveShareLink(admin, token);
    if (resolved.state === 'missing') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (resolved.state === 'dead') {
      await logShareAccess(admin, resolved.link, 'denied', request);
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }
    const { link, stakeholder } = resolved;
    if (link.otp_required && !verifyUnlock(unlockFromRequest(request), link.id)) {
      await logShareAccess(admin, link, 'document_denied', request, docId);
      return NextResponse.json({ error: 'Verification required' }, { status: 401 });
    }

    const { data: doc } = await admin
      .from('deal_documents')
      .select('id, title, storage_path, mime_type, visibility, superseded_by')
      .eq('id', docId)
      .eq('deal_id', link.deal_id)
      .eq('account_id', link.account_id)
      .maybeSingle();
    if (
      !doc ||
      !canStakeholderOpenDocument(stakeholder, {
        visibility: doc.visibility as DealVisibility,
      })
    ) {
      await logShareAccess(admin, link, 'document_denied', request, docId);
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!doc.storage_path?.startsWith(`${DEAL_DOCUMENT_BUCKET}/`)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const objectPath = doc.storage_path.slice(DEAL_DOCUMENT_BUCKET.length + 1);
    const mime = (doc.mime_type ?? '').toLowerCase();

    if (IMAGE_TYPES.includes(mime)) {
      const { data: file } = await admin.storage
        .from(DEAL_DOCUMENT_BUCKET)
        .download(objectPath);
      if (!file) {
        return NextResponse.json({ error: 'Document unavailable' }, { status: 404 });
      }
      const stamped = await watermarkImage(
        Buffer.from(await file.arrayBuffer()),
        watermarkLabel({
          viewerLabel: stakeholder.name,
          reference: `TXN ${link.deal_id.slice(0, 8).toUpperCase()}`,
        })
      );
      await logShareAccess(admin, link, 'document_view', request, docId);
      return new NextResponse(new Uint8Array(stamped.buffer), {
        headers: {
          'Content-Type': stamped.contentType,
          'Cache-Control': 'private, no-store',
          'Content-Disposition': `inline; filename="${doc.title.replace(/[^\w.-]+/g, '_')}.jpg"`,
        },
      });
    }

    const url = await signedUrlFor(DEAL_DOCUMENT_BUCKET, doc.storage_path, 60);
    if (!url) {
      return NextResponse.json({ error: 'Document unavailable' }, { status: 404 });
    }
    await logShareAccess(admin, link, 'document_view', request, docId);
    return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[deal-share] document failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
