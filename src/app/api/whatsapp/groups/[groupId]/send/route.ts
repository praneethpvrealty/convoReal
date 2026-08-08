// ============================================================
// POST /api/whatsapp/groups/[groupId]/send
//
// Text or a staged attachment into a group. Interactive messages are
// refused before they reach Meta — groups answer 130501 and the members
// see nothing at all, which is worse than a refusal the agent can read.
//
// There is no 24-hour window here: group messaging is priced per
// message, and there is no single contact whose last inbound would
// define one.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendGroupMessage } from '@/lib/whatsapp/group-send';
import { isMediaKind, normalizeCaption } from '@/lib/whatsapp/media-kinds';
import type { MediaKind } from '@/lib/whatsapp/meta-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  let accountId: string;
  let userId: string;
  try {
    ({ accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const limit = checkRateLimit(`group-send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const { groupId } = await params;
    const body = await request.json().catch(() => null);
    const messageType = body?.message_type === 'media' ? 'media' : 'text';

    if (messageType === 'media') {
      if (
        typeof body?.media_url !== 'string' ||
        !body.media_url.startsWith(`chat-media/${accountId}/`)
      ) {
        return NextResponse.json(
          { error: 'media_url must be an attachment staged by this account' },
          { status: 400 },
        );
      }
      if (!isMediaKind(body?.media_kind)) {
        return NextResponse.json(
          { error: 'media_kind must be one of image, video, audio, document' },
          { status: 400 },
        );
      }
    } else if (!body?.content_text?.trim()) {
      return NextResponse.json(
        { error: 'content_text is required' },
        { status: 400 },
      );
    }

    const result = await sendGroupMessage({
      accountId,
      groupId,
      userId,
      senderType: 'agent',
      kind: messageType,
      text: messageType === 'text' ? body.content_text : null,
      mediaKind: messageType === 'media' ? (body.media_kind as MediaKind) : null,
      mediaLink: messageType === 'media' ? body.media_url : null,
      mediaCaption:
        messageType === 'media'
          ? (normalizeCaption(body.media_kind as MediaKind, body.content_text) ?? null)
          : null,
      mediaFilename:
        messageType === 'media' && body.media_kind === 'document'
          ? body.media_filename || null
          : null,
      replyToMessageId: body?.reply_to_message_id || null,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Could not send to the group' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    });
  } catch (error) {
    console.error('[groups/send] failed:', error);
    return NextResponse.json(
      { error: 'Could not send to the group' },
      { status: 500 },
    );
  }
}
