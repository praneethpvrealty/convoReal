import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import { buyerCardProperty } from './feed-card';

describe('buyerCardProperty', () => {
  it('[CNV-016] never sends the tower or floor the matcher scored, nor the internal fields', () => {
    const card = buyerCardProperty({
      id: 'p1',
      title: '3 BHK in Prestige Meridian',
      project: 'Prestige Meridian',
      location: 'Meridian Park',
      facing_direction: 'East',
      tower: '10',
      floor_number: 12,
      notes: 'owner will negotiate',
      tags: ['hot'],
      images: [],
    } as unknown as Property);
    expect(card.tower).toBeUndefined();
    expect(card.floor_number).toBeUndefined();
    expect(card.notes).toBeUndefined();
    expect(card.tags).toBeUndefined();
    expect(card.facing_direction).toBe('East');
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty('tower');
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty('floor_number');
  });
});
