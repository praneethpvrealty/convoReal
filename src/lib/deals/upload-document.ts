// Filing a document into a deal folder from the browser.
//
// Two calls: the route signs one upload for one path under this deal's
// folder, the bytes go to Supabase Storage directly, then the row is
// filed against the path. Nothing large crosses a serverless function,
// which caps a request body at 4.5 MB — an eleventh of what the folder
// accepts.
//
// Mirrored by `uploadDealDocument` in mobile/lib/deal-workspace-api.ts.

import type { DealDocument } from '@/lib/invoices/types';

interface SignedUpload {
  upload_url: string;
  storage_path: string;
  mime_type: string;
}

export async function uploadDealDocument(
  dealId: string,
  file: File,
  category: string,
  contactId?: string | null
): Promise<DealDocument> {
  const signRes = await fetch(`/api/deals/${dealId}/documents/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type,
      size: file.size,
    }),
  });
  const signed = await signRes.json().catch(() => null);
  if (!signRes.ok) {
    // The route names the actual limit, which is more use than "failed".
    throw new Error(signed?.error || 'Upload failed');
  }

  const { upload_url, storage_path, mime_type } = signed.data as SignedUpload;

  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: {
      'content-type': mime_type,
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
    },
    body: file,
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      detail = parsed.message || parsed.error || '';
    } catch {
      detail = body.trim().slice(0, 120);
    }
    throw new Error(
      detail
        ? `Storage refused the file (${putRes.status}): ${detail}`
        : `Storage refused the file (${putRes.status}).`
    );
  }

  const fileRes = await fetch(`/api/deals/${dealId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storage_path,
      category,
      title: file.name,
      ...(contactId ? { contact_id: contactId } : {}),
    }),
  });
  const filed = await fileRes.json().catch(() => null);
  if (!fileRes.ok) {
    throw new Error(filed?.error || 'Upload failed');
  }
  return filed.data as DealDocument;
}
