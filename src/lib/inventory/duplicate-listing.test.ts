import { describe, it, expect } from 'vitest';
import {
  buildDuplicateListingInsert,
  duplicateListingTitle,
} from './duplicate-listing';
import type { Property } from '@/types';

const source = {
  id: 'prop-1',
  account_id: 'acct-old',
  user_id: 'user-old',
  property_code: 'PROP-1001',
  title: 'Prestige Lakeside — Unit 402',
  description: 'Corner unit',
  price: 12000000,
  location: 'Whitefield',
  city: 'Bengaluru',
  type: 'Apartment',
  status: 'Sold',
  bedrooms: 3,
  project: 'Prestige Lakeside',
  tower: 'B',
  unit_no: '402',
  features: ['Gym'],
  tags: ['hot'],
  images: ['a.jpg', 'b.jpg'],
  documents: ['deed.pdf'],
  private_images: ['p.jpg'],
  video_url: 'video.mp4',
  video_status: 'ready',
  youtube_video_id: 'yt1',
  is_published: true,
  is_starred: true,
  like_count: 12,
  rating_count: 3,
  sold_price: 11800000,
  deal_mode: 'aggressive',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
} as unknown as Property;

describe('buildDuplicateListingInsert', () => {
  const copy = buildDuplicateListingInsert(source, {
    accountId: 'acct-new',
    userId: 'user-new',
  });

  it('scopes the copy to the acting account and user', () => {
    expect(copy.account_id).toBe('acct-new');
    expect(copy.user_id).toBe('user-new');
  });

  it('carries the details that describe the property', () => {
    expect(copy.location).toBe('Whitefield');
    expect(copy.project).toBe('Prestige Lakeside');
    expect(copy.tower).toBe('B');
    expect(copy.bedrooms).toBe(3);
    expect(copy.price).toBe(12000000);
    expect(copy.features).toEqual(['Gym']);
    expect(copy.tags).toEqual(['hot']);
  });

  it('leaves media behind', () => {
    expect(copy.images).toEqual([]);
    expect(copy.documents).toEqual([]);
    expect(copy).not.toHaveProperty('private_images');
    expect(copy).not.toHaveProperty('video_url');
    expect(copy).not.toHaveProperty('video_status');
    expect(copy).not.toHaveProperty('youtube_video_id');
  });

  it('leaves identity, lifecycle and engagement behind', () => {
    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('property_code');
    expect(copy).not.toHaveProperty('unit_no');
    expect(copy).not.toHaveProperty('created_at');
    expect(copy).not.toHaveProperty('updated_at');
    expect(copy).not.toHaveProperty('like_count');
    expect(copy).not.toHaveProperty('rating_count');
    expect(copy).not.toHaveProperty('sold_price');
    expect(copy).not.toHaveProperty('is_starred');
    expect(copy).not.toHaveProperty('deal_mode');
  });

  it('starts the copy as an unpublished available draft', () => {
    expect(copy.status).toBe('Available');
    expect(copy.is_published).toBe(false);
    expect(copy.title).toBe('Prestige Lakeside — Unit 402 (Copy)');
  });

  it('omits fields the source does not carry', () => {
    const sparse = buildDuplicateListingInsert(
      { title: 'Plot', location: 'Devanahalli' } as Property,
      { accountId: 'a', userId: null }
    );
    expect(sparse).not.toHaveProperty('bedrooms');
    expect(sparse.user_id).toBeNull();
  });
});

describe('duplicateListingTitle', () => {
  it('falls back when the title is blank', () => {
    expect(duplicateListingTitle('   ')).toBe('Untitled listing (Copy)');
  });

  it('keeps a very long title within column bounds', () => {
    expect(duplicateListingTitle('x'.repeat(300))).toHaveLength(202);
  });
});
