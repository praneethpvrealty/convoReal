// ============================================================
// "Save this one" — pointed at a message from last week.
//
// An owner forwards a listing, the draft sits unconfirmed, and an hour
// later DRAFT_SESSION_TIMEOUT_MS discards it. The listing text is still
// in the thread, so the natural thing to do is quote-reply it and say
// "add this". That did nothing useful: bot_message_targets only knows
// about cards WE sent, so the reply resolved to no target, and the
// intake classifier read the two words of the reply — not the listing
// being pointed at — and answered "I couldn't tell what that was".
//
// The quoted message is right there in `messages`. This finds it and
// hands it back so the intake can be run again on what the owner
// actually meant.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Content types worth re-running. Audio is excluded: a voice note is
 *  handled by the scheduler at arrival and has no stored transcript to
 *  replay, so pointing at one would silently do nothing. */
export type ReplayableContentType = 'text' | 'image' | 'document' | 'video';

const REPLAYABLE: ReplayableContentType[] = ['text', 'image', 'document', 'video'];

export interface ReplayableMessage {
  /** messages.id — for logging, not for WhatsApp. */
  id: string;
  contentType: ReplayableContentType;
  contentText: string | null;
  /** Meta's media id, recovered from the stored proxy path. */
  mediaId: string | null;
}

/**
 * The Meta media id back out of `/api/whatsapp/media/<id>`.
 *
 * Inbound media is stored as that proxy path rather than a Meta CDN
 * URL (§2.7), so the id has to be read back off the end of it. Anything
 * that is not our own proxy path returns null — a Supabase Storage URL
 * belongs to an outbound message and is not re-fetchable from Meta.
 */
export function mediaIdFromUrl(url: string | null | undefined): string | null {
  const match = /^\/api\/whatsapp\/media\/([^/?#]+)$/.exec((url || '').trim());
  return match ? match[1] : null;
}

/** True when there is something for the intake to chew on. */
export function isReplayable(row: {
  content_type: string;
  content_text: string | null;
  media_url: string | null;
}): boolean {
  if (!REPLAYABLE.includes(row.content_type as ReplayableContentType)) return false;
  if (row.content_text && row.content_text.trim()) return true;
  return mediaIdFromUrl(row.media_url) !== null;
}

/**
 * The stored inbound message a quote-reply is pointing at.
 *
 * Only the contact's OWN messages: our bot cards already route through
 * bot_message_targets, and re-running the intake over a confirmation
 * card would parse our own summary back into a second listing.
 *
 * Returns null for anything unreplayable, which leaves the caller's
 * existing behaviour exactly as it was.
 */
export async function resolveReplayTarget(
  db: SupabaseClient,
  conversationId: string,
  contextId: string | null | undefined
): Promise<ReplayableMessage | null> {
  if (!contextId) return null;

  const { data, error } = await db
    .from('messages')
    .select('id, content_type, content_text, media_url, sender_type')
    .eq('conversation_id', conversationId)
    .eq('message_id', contextId)
    .maybeSingle();

  if (error) {
    console.error('[message-replay] lookup failed:', error);
    return null;
  }
  if (!data || data.sender_type !== 'customer') return null;
  if (!isReplayable(data)) return null;

  return {
    id: data.id as string,
    contentType: data.content_type as ReplayableContentType,
    contentText: (data.content_text as string | null) ?? null,
    mediaId: mediaIdFromUrl(data.media_url as string | null),
  };
}

/**
 * The text the intake should read: what was originally sent, with
 * whatever the owner typed on the reply after it.
 *
 * Both, not one or the other. The original carries the listing; the
 * reply is where a correction rides in ("add this one, but it's 1.2cr
 * now"). A bare "save this" is harmless noise to the parser, which is
 * cheaper than trying to work out which replies are instructions.
 */
export function replayText(
  original: string | null,
  reply: string | null | undefined
): string {
  return [original?.trim(), reply?.trim()].filter(Boolean).join('\n');
}
