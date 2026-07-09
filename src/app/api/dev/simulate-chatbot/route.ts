import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  classifyImageOrText,
  parseListingFromImageOrText,
  parseContactFromImageOrText,
} from '@/lib/ai/gemini';
import {
  validateDraft,
  validateContactDraftsContainer,
  formatDraftPreviewMessage,
  formatContactDraftsPreview,
  backfillLocationFromMapLink,
  deriveDraftStatus,
} from '@/lib/ai/intake-core';

// POST /api/dev/simulate-chatbot
// Internal dev tool: runs the exact classify -> parse -> validate ->
// preview pipeline the WhatsApp owner chatbot uses (chatbot-engine.ts),
// without a real WhatsApp message, without creating a draft session,
// and without burning the account's AI credits — so you can iterate on
// prompts/parsing and see the precise preview text a real message would
// produce, safely and for free. Requires being signed into an account
// (any role) — never public.
//
// This deliberately does NOT call burnCredits(): it mirrors the
// account's own real classify/parse behavior via live Gemini calls
// (so the RESULT is representative), but the credit cost of running
// this tool is treated as a dev-tooling cost, not a production charge.

const MAX_TEXT_LEN = 5000;

export async function POST(request: Request) {
  try {
    // Any signed-in account member may use this — it's read-only
    // against their own account's AI pipeline, never another tenant's.
    await requireRole('viewer');

    const body = (await request.json().catch(() => null)) as {
      text?: string;
      imageBase64?: string;
      mimeType?: string;
    } | null;

    const text = (body?.text || '').trim().slice(0, MAX_TEXT_LEN);
    const imageBase64 = body?.imageBase64 || null;
    const mimeType = body?.mimeType || null;

    if (!text && !imageBase64) {
      return NextResponse.json({ error: 'Provide message text and/or an image.' }, { status: 400 });
    }

    const mediaBuffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : undefined;

    const classification = await classifyImageOrText(text, mediaBuffer, mimeType || undefined);

    if (classification === 'contact') {
      const container = mediaBuffer && mimeType
        ? await parseContactFromImageOrText(text, mediaBuffer, mimeType)
        : await parseContactFromImageOrText(text);
      const { isValid, missingFields } = validateContactDraftsContainer(container);
      const status = deriveDraftStatus(isValid);
      const previewText = formatContactDraftsPreview('📝 *Contact Drafts (simulated)*', container, status, missingFields);

      return NextResponse.json({ classification, draft: container, isValid, missingFields, status, previewText });
    }

    if (classification === 'property') {
      let draft = mediaBuffer && mimeType
        ? await parseListingFromImageOrText(text, mediaBuffer, mimeType)
        : await parseListingFromImageOrText(text);
      draft = await backfillLocationFromMapLink(draft);
      const { isValid, missingFields } = validateDraft(draft);
      const status = deriveDraftStatus(isValid);
      const previewText = formatDraftPreviewMessage('📝 *Listing Draft (simulated)*', draft, status, missingFields);

      return NextResponse.json({ classification, draft, isValid, missingFields, status, previewText });
    }

    // Neither property nor contact — the real bot would not start a
    // draft session; surface the raw classification for visibility.
    return NextResponse.json({ classification, draft: null, isValid: null, missingFields: [], status: null, previewText: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
