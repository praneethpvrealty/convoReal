// ============================================================
// The gate every media send passes through.
//
// `media_url` names an object in our own bucket, not a URL Meta is
// handed as given — otherwise the business number becomes a fetcher for
// whatever a caller points it at. The prefix check proves the object
// belongs to this account; the read-back proves it exists and is what
// it claimed to be when the upload was signed, which the server no
// longer knows first-hand now that the bytes go to storage directly.
// ============================================================

import { CHAT_MEDIA_BUCKET, stagedChatMedia } from '@/lib/storage/chat-media';
import { rejectMedia } from '@/lib/whatsapp/media-kinds';

export interface StagedMediaRefusal {
  error: string;
  code?: string;
  status: number;
}

/** Why this attachment cannot be sent, or null if it can. */
export async function refuseStagedMedia(
  accountId: string,
  mediaUrl: unknown
): Promise<StagedMediaRefusal | null> {
  if (
    typeof mediaUrl !== 'string' ||
    !mediaUrl.startsWith(`${CHAT_MEDIA_BUCKET}/${accountId}/`)
  ) {
    return {
      error: 'media_url must be an attachment staged by this account',
      status: 400,
    };
  }

  const staged = await stagedChatMedia(mediaUrl);
  if (!staged) {
    return {
      error: 'That attachment did not finish uploading — attach it again.',
      status: 400,
    };
  }

  const rejection = rejectMedia(staged.mimeType, staged.size);
  if (rejection) {
    return { error: rejection.error, code: rejection.code, status: 415 };
  }

  return null;
}
