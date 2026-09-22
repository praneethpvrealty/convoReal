// Staging an inbox attachment from the browser.
//
// Two calls: the route decides where the file may go and signs one
// upload for that path, then the bytes are PUT to Supabase Storage
// directly. Nothing large crosses a serverless function, so the caps
// the composer advertises are the caps that actually apply.
//
// Mirrored by `uploadChatMedia` in mobile/lib/api.ts — the two surfaces
// stage identically and both hand the returned `media_url` to
// /api/whatsapp/send.

export interface StagedAttachment {
  media_url: string;
  media_kind: 'image' | 'video' | 'audio' | 'document';
  filename: string | null;
  mime_type: string;
  size: number;
}

interface SignedUpload extends StagedAttachment {
  upload_url: string;
}

export async function stageChatAttachment(
  file: File
): Promise<StagedAttachment> {
  const signRes = await fetch('/api/whatsapp/media/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type,
      size: file.size,
    }),
  });
  const signed = await signRes.json();
  if (!signRes.ok) {
    // The route names the actual limit ("WhatsApp caps video at 16 MB —
    // this is 40 MB"), which is more use than "failed".
    throw new Error(signed.error || 'Could not upload the attachment');
  }

  const { upload_url, ...staged } = signed.data as SignedUpload;

  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: {
      'content-type': staged.mime_type,
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
    },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error('Could not upload the attachment — try again.');
  }

  return staged;
}
