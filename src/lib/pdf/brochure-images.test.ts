import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadPropertyDocument = vi.fn();
const uploadPropertyImage = vi.fn();

class FakeTooLarge extends Error {
  constructor(readonly bytes: number) {
    super(`too large: ${bytes}`);
    this.name = 'DocumentTooLargeError';
  }
}

vi.mock('@/lib/storage/upload', () => ({
  uploadPropertyDocument: (...a: unknown[]) => uploadPropertyDocument(...a),
  uploadPropertyImage: (...a: unknown[]) => uploadPropertyImage(...a),
  DocumentTooLargeError: FakeTooLarge,
}));

const { storeBrochureDocument } = await import('./brochure-images');

beforeEach(() => {
  uploadPropertyDocument.mockReset();
  uploadPropertyImage.mockReset();
});

describe('storeBrochureDocument', () => {
  const buf = Buffer.alloc(64);

  it('returns the stored path when the file fits', async () => {
    uploadPropertyDocument.mockResolvedValue('property-documents/acc/deck.pdf');
    const result = await storeBrochureDocument(
      'acc',
      buf,
      'application/pdf',
      'deck.pdf'
    );
    expect(result).toEqual({
      url: 'property-documents/acc/deck.pdf',
      droppedBytes: null,
    });
  });

  it('drops an oversize file instead of failing the whole message', async () => {
    const big = Buffer.alloc(1024);
    uploadPropertyDocument.mockRejectedValue(new FakeTooLarge(1024));
    const result = await storeBrochureDocument(
      'acc',
      big,
      'application/pdf',
      'huge.pdf'
    );
    // The contents are extracted separately — losing the file must not
    // lose the listing, which is what used to happen.
    expect(result.url).toBeNull();
    expect(result.droppedBytes).toBe(1024);
  });

  it('reports the size so the sender can be told why', async () => {
    const big = Buffer.alloc(53 * 1024 * 1024);
    uploadPropertyDocument.mockRejectedValue(new FakeTooLarge(big.length));
    const { droppedBytes } = await storeBrochureDocument(
      'acc',
      big,
      'application/pdf',
      'APG.pdf'
    );
    expect(droppedBytes).toBe(53 * 1024 * 1024);
  });

  it('still throws on a failure that is not about size', async () => {
    uploadPropertyDocument.mockRejectedValue(new Error('bucket not found'));
    await expect(
      storeBrochureDocument('acc', buf, 'application/pdf', 'deck.pdf')
    ).rejects.toThrow('bucket not found');
  });
});
