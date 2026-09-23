import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadDealDocument } from './upload-document';

function stubStorage(put: Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/upload-url')) {
      return Response.json({
        data: {
          upload_url: 'https://storage.test/signed',
          storage_path: 'deal-documents/acc-1/deal-1/1-deed.pdf',
          mime_type: 'application/pdf',
        },
      });
    }
    if (url === 'https://storage.test/signed') return put;
    return Response.json({ data: { id: 'doc-1' } }, { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const deed = () =>
  new File([new Uint8Array(16)], 'deed.pdf', { type: 'application/pdf' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadDealDocument', () => {
  it('[INV-008] reports a storage refusal with its status and reason', async () => {
    stubStorage(
      new Response(
        JSON.stringify({
          statusCode: '415',
          error: 'invalid_mime_type',
          message: 'mime type application/octet-stream is not supported',
        }),
        { status: 400 }
      )
    );

    await expect(
      uploadDealDocument('deal-1', deed(), 'agreement')
    ).rejects.toThrow(
      'Storage refused the file (400): mime type application/octet-stream is not supported'
    );
  });

  it('[INV-008] reports a refusal with no readable body by its status', async () => {
    stubStorage(new Response('', { status: 403 }));

    await expect(
      uploadDealDocument('deal-1', deed(), 'agreement')
    ).rejects.toThrow('Storage refused the file (403).');
  });

  it('files the document once storage accepts it', async () => {
    const fetchMock = stubStorage(new Response(null, { status: 200 }));

    await expect(
      uploadDealDocument('deal-1', deed(), 'agreement')
    ).resolves.toEqual({ id: 'doc-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
