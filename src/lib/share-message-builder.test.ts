import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildPropertyShareMessage,
  buildShareTargets,
  formatShareAmount,
} from './share-message-builder';

const baseProperty = {
  id: 'p1',
  title: '15000 sqft Residential Land in Koramangala',
  type: 'Residential Land/ Plot',
  listing_type: 'Sale',
  price: 450000000,
  location: 'Koramangala',
  sublocality: 'Koramangala',
  city: 'Bangalore',
  state: 'Karnataka',
  land_area: 15000,
  land_area_unit: 'sqft',
  facing_direction: 'East',
  road_width: 40,
  road_width_unit: 'ft',
  features: ['Corner plot', 'Clear title', 'BBMP A-khata'],
  nearby_highlights: ['Forum Mall 1km', 'Metro 2km'],
  google_map_link: 'https://maps.app.goo.gl/xyz',
  is_published: true,
  images: [],
} as unknown as Property;

const URL = 'https://www.convoreal.com/?property_id=p1&mode=view';

describe('formatShareAmount', () => {
  it('formats INR in Cr and Lakhs', () => {
    expect(formatShareAmount(450000000)).toBe('₹45 Cr');
    expect(formatShareAmount(2500000)).toBe('₹25 Lakhs');
  });

  it('returns empty for missing amounts', () => {
    expect(formatShareAmount(0)).toBe('');
    expect(formatShareAmount(null)).toBe('');
  });
});

describe('buildPropertyShareMessage', () => {
  it('quick level is a short teaser with title, price, link', () => {
    const msg = buildPropertyShareMessage({
      property: baseProperty,
      url: URL,
      audience: 'client',
      detail: 'quick',
      tone: 'professional',
    });
    expect(msg).toContain('*15000 sqft Residential Land in Koramangala*');
    expect(msg).toContain('₹45 Cr');
    expect(msg).toContain(URL);
    expect(msg).not.toContain('East facing');
  });

  it('complete level includes every filled field', () => {
    const msg = buildPropertyShareMessage({
      property: baseProperty,
      url: URL,
      audience: 'agent',
      detail: 'complete',
      tone: 'professional',
      agentName: 'Praneeth',
      agentPhone: '+919812345678',
    });
    expect(msg).toContain('co-broke');
    expect(msg).toContain('📍 Koramangala, Bangalore, Karnataka');
    expect(msg).toContain('💰 *₹45 Cr*');
    expect(msg).toContain('15000 sqft');
    expect(msg).toContain('East facing');
    expect(msg).toContain('40 ft road');
    expect(msg).toContain('Corner plot | Clear title | BBMP A-khata');
    expect(msg).toContain('🚩 Nearby: Forum Mall 1km | Metro 2km');
    expect(msg).toContain('🗺 Map: https://maps.app.goo.gl/xyz');
    expect(msg).toContain(URL);
    expect(msg).toContain('Regards, Praneeth');
    expect(msg).toContain('+919812345678');
  });

  it('rent listings show monthly rent with maintenance', () => {
    const rental = {
      ...baseProperty,
      listing_type: 'Rent',
      rent_per_month: 85000,
      maintenance: 5000,
      price: 0,
    } as unknown as Property;
    const msg = buildPropertyShareMessage({
      property: rental,
      url: URL,
      audience: 'client',
      detail: 'standard',
      tone: 'friendly',
    });
    expect(msg).toContain('₹85,000/mo + ₹5,000 maintenance');
    expect(msg).toContain('👋');
  });

  it('tones change the client intro', () => {
    const casual = buildPropertyShareMessage({
      property: baseProperty,
      url: URL,
      audience: 'client',
      detail: 'standard',
      tone: 'casual',
    });
    expect(casual).toContain('Hey!');
  });

  it('skips empty sections instead of printing blanks', () => {
    const bare = {
      id: 'p2',
      title: 'Bare listing',
      type: '',
      listing_type: 'Sale',
      price: 5000000,
      location: '',
      features: [],
      images: [],
      is_published: false,
    } as unknown as Property;
    const msg = buildPropertyShareMessage({
      property: bare,
      url: URL,
      audience: 'client',
      detail: 'complete',
      tone: 'professional',
    });
    expect(msg).not.toContain('📍');
    expect(msg).not.toContain('✨');
    expect(msg).not.toContain('🗺');
  });
});

describe('buildShareTargets', () => {
  it('encodes the message into each deep link', () => {
    const targets = buildShareTargets('Hello *world* & co', URL, 'My Property');
    expect(targets.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent('Hello *world* & co')}`);
    expect(targets.telegram).toContain(encodeURIComponent(URL));
    expect(targets.email).toContain('subject=My%20Property');
    expect(targets.sms.startsWith('sms:?&body=')).toBe(true);
  });
});
