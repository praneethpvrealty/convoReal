// ============================================================
// "Sir can I get images  images"
//
// A buyer asking for the photos of the listing they were just sent.
// Nothing routed it: it is not question-shaped (no "?", it opens with
// "Sir"), it carries no property type or budget, and it numbers no
// shortlist entry — so the qualification ladder claimed it and replied
// "what kind of property are you looking for?", restarting the intake
// of a buyer who was already reading a listing. The photos went out by
// hand, eight minutes later, from an agent who noticed.
//
// Deterministic, like requestsHumanContact and for the same reason:
// whether a listing's own photos are sent is too cheap to pay an
// intent call for and too important to leave to one. Only the public
// `images` array ever travels — private_images and gated photos stay
// behind their proxy no matter how the request is worded.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { accountPropertyShowcaseUrl } from '@/lib/showcase/account-showcase-url';

/** Photos per listing in one reply. WhatsApp renders each as its own
 *  bubble, so a full gallery would bury the conversation; the closing
 *  text links the rest. Halved when the buyer asked about several
 *  listings at once, for the same reason. */
const PHOTOS_SINGLE_SUBJECT = 4;
const PHOTOS_PER_SUBJECT_MULTI = 2;

const MEDIA_NOUN = 'photos?|pics?|pix|pictures?|images?|imgs?|videos?|snaps?';

/** A request verb with a media noun within reach of it — "can I get
 *  images", "send pics of the villa", "want to see more photos". */
const MEDIA_REQUEST = new RegExp(
  `\\b(send|share|get|see|view|show|forward|provide|need|want|waiting for|any|some|more|few)\\b[^.?!\\n]{0,40}?\\b(${MEDIA_NOUN})\\b`,
  'i'
);

/** The whole message is the ask — "Photos?", "pics please". */
const BARE_MEDIA_MESSAGE = new RegExp(
  `^\\s*(?:please\\s+|pls\\s+|plz\\s+|sir\\s+)*(?:${MEDIA_NOUN})\\s*(?:please|pls|plz)?\\s*[?.!\\s]*$`,
  'i'
);

/** The sender offering media, not asking for it — "I want to add
 *  photos", "uploaded the pics". Owner intake owns those messages. */
const PROVIDING_MEDIA =
  /\b(add|adding|added|upload|uploading|uploaded|attach|attaching|attached)\b/i;

const VIDEO_ASK = /\b(videos?|walk ?through)\b/i;

/**
 * True when the message asks to be sent a listing's photos or video.
 */
export function requestsPropertyPhotos(text?: string | null): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (PROVIDING_MEDIA.test(t)) return false;
  return MEDIA_REQUEST.test(t) || BARE_MEDIA_MESSAGE.test(t);
}

/**
 * What the lead hears when the photos cannot be sent — no listing
 * pinned to the thread, or a gallery the confidential switch emptied.
 * Same obligation as HANDOVER_TEXT: only the handover branch may send
 * it, because that is what tells an agent the photos are now owed.
 */
export function photoHandoverText(title?: string | null): string {
  return title
    ? `Let me get the photos of *${title}* from the team — I'll send them right across.`
    : "Let me get those photos from the team — I'll send them right across.";
}

export interface PhotoReplyPart {
  title: string | null;
  sent: number;
  total: number;
  url: string;
}

/**
 * The text that follows the photos, closing with the showcase link —
 * the gallery holds what the reply left out, and the link is attributed
 * to this contact the same way every other share is.
 */
export function buildPhotoReplyText(parts: PhotoReplyPart[]): string {
  const invite = 'Want a site visit or more details? Just reply here.';

  if (parts.length === 1) {
    const p = parts[0];
    const name = p.title ? `*${p.title}*` : 'the property';
    const opener =
      p.sent === 1
        ? `Here's a photo of ${name} 👆`
        : `Here are the photos of ${name} 👆`;
    const link =
      p.total > p.sent
        ? `All ${p.total} photos and full details: ${p.url}`
        : `Full details here: ${p.url}`;
    return [opener, link, '', invite].join('\n');
  }

  const lines = parts.map(
    (p) => `${p.title ? `*${p.title}*` : 'Property'}: ${p.url}`
  );
  return ['Here are the photos 👆', '', ...lines, '', invite].join('\n');
}

interface PhotoSubjectRow {
  id: string;
  title: string | null;
  images: string[] | null;
  property_code: string | null;
  video_url: string | null;
  video_status: string | null;
}

export interface SendSubjectPhotosArgs {
  db: SupabaseClient;
  accountId: string;
  userId?: string | null;
  contactId: string;
  conversationId: string;
  /** Already resolved by questionSubjectProperties — the shortlist
   *  numbers the buyer used, or the share ledger. */
  propertyIds: string[];
  requestText: string;
}

/**
 * Sends the subjects' own photos, then one closing text with the
 * gallery link. Returns false when nothing could be sent — no subject,
 * no public images, or every send failed — so the caller falls back to
 * a handover instead of leaving the buyer unanswered.
 */
export async function sendSubjectPhotos(
  args: SendSubjectPhotosArgs
): Promise<boolean> {
  const { db, accountId, userId, contactId, conversationId, propertyIds } =
    args;
  if (propertyIds.length === 0) return false;

  const { data } = await db
    .from('properties')
    .select('id, title, images, property_code, video_url, video_status')
    .eq('account_id', accountId)
    .in('id', propertyIds);

  const rows = propertyIds
    .map((id) => ((data ?? []) as PhotoSubjectRow[]).find((r) => r.id === id))
    .filter((r): r is PhotoSubjectRow => !!r);
  if (rows.length === 0) return false;

  const wantsVideo = VIDEO_ASK.test(args.requestText);
  const perSubject =
    rows.length === 1 ? PHOTOS_SINGLE_SUBJECT : PHOTOS_PER_SUBJECT_MULTI;
  const parts: PhotoReplyPart[] = [];

  for (const row of rows) {
    const images = (row.images ?? []).filter((u) => u && u.trim().length > 0);
    let sent = 0;

    for (const [i, image] of images.slice(0, perSubject).entries()) {
      const res = await sendWhatsAppMessageAndPersist({
        accountId,
        userId,
        contactId,
        conversationId,
        kind: 'media',
        mediaKind: 'image',
        mediaLink: image,
        mediaCaption: i === 0 && row.title ? `📸 *${row.title}*` : undefined,
        senderType: 'bot',
      });
      if (res.success) sent += 1;
    }

    if (wantsVideo && row.video_url && row.video_status === 'ready') {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId,
        contactId,
        conversationId,
        kind: 'media',
        mediaKind: 'video',
        mediaLink: row.video_url,
        mediaCaption: row.title ? `🎬 *${row.title}*` : undefined,
        senderType: 'bot',
      });
    }

    if (sent > 0) {
      parts.push({
        title: row.title,
        sent,
        total: images.length,
        url: await accountPropertyShowcaseUrl(db, accountId, row, contactId),
      });
    }
  }

  if (parts.length === 0) return false;

  await sendWhatsAppMessageAndPersist({
    accountId,
    userId,
    contactId,
    conversationId,
    kind: 'text',
    text: buildPhotoReplyText(parts),
    senderType: 'bot',
  });

  return true;
}
