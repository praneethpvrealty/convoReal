import { describe, it, expect } from 'vitest';
import {
  guardedPhotoPath,
  internalPhotoCount,
  internalPhotoSources,
} from '@/lib/inventory/photo-sources';

describe('internalPhotoSources', () => {
  // The bug this exists to prevent: gating a listing moved every photo
  // into the guarded bucket, `images` went empty, and the agent's own
  // gallery rendered nothing at all.
  it('finds the photos of a fully gated listing', () => {
    const sources = internalPhotoSources({
      id: 'p1',
      images: [],
      private_images: ['property-images-private/a/1.jpg', 'x/2.jpg'],
    });
    expect(sources).toEqual([
      { url: '/api/properties/p1/private-images/0', guarded: true },
      { url: '/api/properties/p1/private-images/1', guarded: true },
    ]);
  });

  // Position is the identifier the proxy reads, so a guarded photo must
  // keep its index in `private_images` — never its index in the merged
  // gallery.
  it('indexes guarded photos by their place in private_images', () => {
    const sources = internalPhotoSources({
      id: 'p1',
      images: ['pub/a.jpg', 'pub/b.jpg'],
      private_images: ['priv/x.jpg'],
    });
    expect(sources).toEqual([
      { url: 'pub/a.jpg', guarded: false },
      { url: 'pub/b.jpg', guarded: false },
      { url: guardedPhotoPath('p1', 0), guarded: true },
    ]);
  });

  it('leaves an ungated listing exactly as it was', () => {
    expect(
      internalPhotoSources({ id: 'p1', images: ['a.jpg'], private_images: [] })
    ).toEqual([{ url: 'a.jpg', guarded: false }]);
  });

  it('survives null, missing and blank entries', () => {
    expect(internalPhotoSources({ id: 'p1' })).toEqual([]);
    expect(
      internalPhotoSources({ id: 'p1', images: null, private_images: null })
    ).toEqual([]);
    expect(
      internalPhotoSources({ id: 'p1', images: ['', '  ', 'a.jpg'] })
    ).toEqual([{ url: 'a.jpg', guarded: false }]);
  });
});

describe('internalPhotoCount', () => {
  it('counts across both buckets', () => {
    expect(
      internalPhotoCount({
        id: 'p1',
        images: ['a.jpg'],
        private_images: ['b.jpg', 'c.jpg'],
      })
    ).toBe(3);
  });
});
