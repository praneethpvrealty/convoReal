import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_SERVICES,
  getAuthorityService,
  localitySlug,
  publishedLocalities,
} from './authority';
import type { Property } from '@/types';

describe('SEO authority content', () => {
  it('uses unique service slugs with factual FAQs', () => {
    expect(
      new Set(AUTHORITY_SERVICES.map((service) => service.slug)).size
    ).toBe(AUTHORITY_SERVICES.length);
    expect(AUTHORITY_SERVICES.every((service) => service.faq.length >= 2)).toBe(
      true
    );
    expect(getAuthorityService('land-due-diligence')?.name).toContain(
      'due-diligence'
    );
  });

  it('normalizes locality slugs', () => {
    expect(localitySlug('Bengaluru Urban')).toBe('bengaluru-urban');
    expect(localitySlug('  JP Nagar & South ')).toBe('jp-nagar-and-south');
  });

  it('creates locality pages only from published inventory passed to it', () => {
    const rows = [
      { id: '1', city: 'Bengaluru' },
      { id: '2', city: 'Bengaluru' },
      { id: '3', city: null },
    ] as Property[];
    const localities = publishedLocalities(rows);
    expect(localities.get('bengaluru')?.properties).toHaveLength(2);
    expect(localities.size).toBe(1);
  });
});
