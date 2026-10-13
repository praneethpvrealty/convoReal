import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_VIEW_AUDIENCE_FILTER,
  effectiveShowcaseAudience,
  effectiveShowcaseVisibility,
  forShowcaseViewer,
  isAgentViewMode,
  isBuyersOnly,
  isTeaserGated,
  opensByDirectLink,
  priceBand,
  teaserTitle,
  toTeaserPropertyView,
  toPublicListingView,
  TEASER_PROPERTY_FIELDS,
} from '@/lib/inventory/showcase-visibility';
import type { Property } from '@/types';

const gatedVilla = {
  id: 'p1',
  account_id: 'a1',
  user_id: 'u1',
  title: 'Luxury Villa at 12 Kanakapura Main Road',
  description: 'Opposite the Reddy family compound, next to the temple.',
  price: 47_500_000,
  location: '12 Kanakapura Main Road, Bengaluru',
  sublocality: 'Kanakapura Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  type: 'Villa',
  listing_type: 'Sale',
  status: 'Available',
  bedrooms: 4,
  area_sqft: 4200,
  dimensions: '60x90',
  project: 'Prestige Glenwood',
  property_code: 'CR-118',
  google_map_link: 'https://maps.google.com/?q=12.9,77.6',
  latitude: 12.9,
  longitude: 77.6,
  images: ['property-images/a1/one.jpg', 'property-images/a1/two.jpg'],
  private_images: ['property-images-private/a1/x.jpg'],
  documents: [{ url: 'doc', title: 'Khata' }],
  showcase_visibility: 'teaser',
  is_published: true,
} as unknown as Property;

describe('effectiveShowcaseVisibility', () => {
  it('derives open when unset — gating is an explicit decision', () => {
    expect(effectiveShowcaseVisibility({})).toBe('open');
    expect(effectiveShowcaseVisibility({ showcase_visibility: null })).toBe(
      'open'
    );
  });

  it('honours an explicit teaser', () => {
    expect(effectiveShowcaseVisibility({ showcase_visibility: 'teaser' })).toBe(
      'teaser'
    );
    expect(isTeaserGated({ showcase_visibility: 'teaser' })).toBe(true);
  });

  it('treats an unrecognised value as open rather than guessing', () => {
    expect(effectiveShowcaseVisibility({ showcase_visibility: 'gated' })).toBe(
      'open'
    );
  });
});

describe('priceBand', () => {
  it('bands crores at half-crore steps', () => {
    expect(priceBand(47_500_000)).toBe('₹4.5 Cr – ₹5 Cr');
  });

  it('bands mid-range lakhs at 25L steps, rolling the upper edge to Cr', () => {
    expect(priceBand(7_800_000)).toBe('₹75 L – ₹1 Cr');
    expect(priceBand(6_200_000)).toBe('₹50 L – ₹75 L');
  });

  it('bands small values at 10L steps', () => {
    expect(priceBand(4_500_000)).toBe('₹40 L – ₹50 L');
  });

  it('returns null rather than a misleading zero band', () => {
    expect(priceBand(0)).toBeNull();
    expect(priceBand(null)).toBeNull();
    expect(priceBand(undefined)).toBeNull();
  });
});

describe('teaserTitle', () => {
  it('names the listing by type and locality, never by the stored title', () => {
    expect(teaserTitle(gatedVilla)).toBe(
      '4 BHK Villa in Kanakapura Road, Bengaluru'
    );
  });

  it('drops the BHK prefix for land', () => {
    expect(teaserTitle({ type: 'Agricultural Land', city: 'Mysuru' })).toBe(
      'Agricultural Land in Mysuru'
    );
  });
});

describe('toTeaserPropertyView', () => {
  const view = toTeaserPropertyView(gatedVilla);

  it('withholds every identifying field', () => {
    expect(view.description).toBeUndefined();
    expect(view.location).toBe('Kanakapura Road, Bengaluru');
    expect(view.google_map_link).toBeUndefined();
    expect(view.latitude).toBeUndefined();
    expect(view.longitude).toBeUndefined();
    expect(view.area_sqft).toBeUndefined();
    expect(view.dimensions).toBeUndefined();
    expect(view.project).toBeUndefined();
    expect(view.property_code).toBeUndefined();
    expect(view.documents).toBeUndefined();
    expect(view.private_images).toBeUndefined();
  });

  it('replaces the stored title, which carries the address', () => {
    expect(view.title).toBe('4 BHK Villa in Kanakapura Road, Bengaluru');
    expect(JSON.stringify(view)).not.toContain('Kanakapura Main Road');
  });

  it('bands the price instead of publishing it', () => {
    expect(view.price).toBeNull();
    expect(view.price_band).toBe('₹4.5 Cr – ₹5 Cr');
  });

  it('shows no photo at all for a location-guarded type', () => {
    expect(view.images).toEqual([]);
    // 2 public + 1 private: the count is what exists, not what is public.
    expect(view.image_count).toBe(3);
  });

  it('counts photos the confidential switch moved to the private bucket', () => {
    const moved = toTeaserPropertyView({
      ...gatedVilla,
      type: 'Apartment',
      images: [],
      private_images: ['a.jpg', 'b.jpg', 'c.jpg'],
    } as unknown as Property);
    expect(moved.images).toEqual([]);
    expect(moved.image_count).toBe(3);
  });

  it('keeps the cover photo when the type is not location-guarded', () => {
    const flat = toTeaserPropertyView({
      ...gatedVilla,
      type: 'Apartment',
    } as Property);
    expect(flat.images).toEqual(['property-images/a1/one.jpg']);
    expect(flat.image_count).toBe(3);
  });

  it('never carries a field outside the teaser whitelist', () => {
    const allowed = new Set<string>([
      ...TEASER_PROPERTY_FIELDS,
      'title',
      'location',
      'images',
      'price',
      'price_band',
      'image_count',
      'location_guarded',
      'location_revealed',
      'private_images_revealed',
      'teaser_gated',
    ]);
    for (const key of Object.keys(view)) {
      expect(allowed.has(key), `unexpected field: ${key}`).toBe(true);
    }
  });
});

describe('toPublicListingView', () => {
  it('reduces a gated listing even in agent mode — that link is public too', () => {
    const view = toPublicListingView(gatedVilla, { revealExact: true });
    expect(view.teaser_gated).toBe(true);
    expect(view.description).toBeUndefined();
  });

  it('opens the page for a grant carrying reveal_listing', () => {
    const view = toPublicListingView(gatedVilla, {
      revealExact: false,
      granted: {
        location: false,
        documents: false,
        privateImages: false,
        listing: true,
      },
    });
    expect(view.teaser_gated).toBeUndefined();
    expect(view.description).toBe(gatedVilla.description);
  });

  it('does not open the page for a grant that only reveals location', () => {
    const view = toPublicListingView(gatedVilla, {
      revealExact: false,
      granted: {
        location: true,
        documents: true,
        privateImages: true,
        listing: false,
      },
    });
    expect(view.teaser_gated).toBe(true);
  });

  it('leaves an ungated listing to the location guard', () => {
    const open = { ...gatedVilla, showcase_visibility: null } as Property;
    const view = toPublicListingView(open, { revealExact: false });
    expect(view.teaser_gated).toBeUndefined();
    expect(view.title).toBe(open.title);
    // Still a guarded type, so the address stays masked.
    expect(view.location).toBe('Kanakapura Road, Bengaluru');
    expect(view.location_guarded).toBe(true);
  });

  it('opening the page does not hand over the address by itself', () => {
    const view = toPublicListingView(gatedVilla, {
      revealExact: false,
      granted: {
        location: false,
        documents: false,
        privateImages: false,
        listing: true,
      },
    });
    expect(view.location).toBe('Kanakapura Road, Bengaluru');
    expect(view.google_map_link).toBeNull();
    expect(view.location_guarded).toBe(true);
  });
});

describe('opensByDirectLink', () => {
  it('[PRP-017] opens a published listing to anyone', () => {
    expect(opensByDirectLink({ is_published: true }, false)).toBe(true);
  });

  it('[PRP-017] opens a draft only for a link carrying its share grant', () => {
    expect(opensByDirectLink({ is_published: false }, false)).toBe(false);
    expect(opensByDirectLink({ is_published: null }, false)).toBe(false);
    expect(opensByDirectLink({ is_published: false }, true)).toBe(true);
  });

  it('[PRP-017] gates every public entry point on it, previews without a grant', () => {
    const read = (path: string) =>
      readFileSync(join(process.cwd(), path), 'utf8');
    const root = read('src/app/(showcase)/page.tsx');
    expect(root).toContain('!property || !opensByDirectLink(property, false)');
    expect(root).toContain(
      'opensByDirectLink(resolvedTarget, draftGrant !== null)'
    );
    const slug = read('src/app/property/[slug]/page.tsx');
    expect(slug).toContain('if (!opensByDirectLink(property, false)) {');
    expect(slug).toContain(
      'if (!opensByDirectLink(property, shareGrant !== null)) notFound();'
    );
    expect(
      slug.indexOf('opensByDirectLink(property, shareGrant !== null)')
    ).toBeLessThan(slug.indexOf('permanentRedirect('));
    expect(read('src/app/api/properties/[id]/og-image/route.ts')).toContain(
      '!opensByDirectLink(raw, false)'
    );
  });
});

describe('showcase audience', () => {
  it('[PRP-046] NULL derives to every viewer; only an explicit buyers_only withholds', () => {
    expect(effectiveShowcaseAudience({})).toBe('all');
    expect(effectiveShowcaseAudience({ showcase_audience: null })).toBe('all');
    expect(effectiveShowcaseAudience({ showcase_audience: 'all' })).toBe('all');
    expect(
      effectiveShowcaseAudience({ showcase_audience: 'buyers_only' })
    ).toBe('buyers_only');
    expect(isBuyersOnly({ showcase_audience: 'buyers_only' })).toBe(true);
    expect(isBuyersOnly({ showcase_audience: 'open' })).toBe(false);
  });

  it('[PRP-046] drops buyers-only rows for the co-broker view and nobody else', () => {
    const rows = [
      { id: 'a' },
      { id: 'b', showcase_audience: 'buyers_only' },
      { id: 'c', showcase_audience: 'all' },
    ];
    expect(forShowcaseViewer(rows, true).map((r) => r.id)).toEqual(['a', 'c']);
    expect(forShowcaseViewer(rows, false)).toBe(rows);
  });

  it('[PRP-046] recognises both spellings of the co-broker view and the SQL filter matches NULL', () => {
    expect(isAgentViewMode('view')).toBe(true);
    expect(isAgentViewMode('agent')).toBe(true);
    expect(isAgentViewMode('buyer')).toBe(false);
    expect(isAgentViewMode(null)).toBe(false);
    expect(AGENT_VIEW_AUDIENCE_FILTER).toBe(
      'showcase_audience.is.null,showcase_audience.neq.buyers_only'
    );
  });

  it('[PRP-046] every co-broker entry point applies the audience', () => {
    const read = (path: string) =>
      readFileSync(join(process.cwd(), path), 'utf8');
    const root = read('src/app/(showcase)/page.tsx');
    expect(root).toContain(
      'cachedResolveVisitorIsAgent(accountId, resolvedParams.v)'
    );
    expect(root).toContain(
      'if (targetHiddenFromViewer) targetProperty = null;'
    );
    expect(root).toContain(
      'isAgentViewMode(resolvedParams.mode) && isBuyersOnly(property)'
    );
    const slug = read('src/app/property/[slug]/page.tsx');
    expect(slug).toContain(
      'if (agentView && isBuyersOnly(property)) notFound();'
    );
    expect(slug.indexOf('isBuyersOnly(property)) notFound()')).toBeLessThan(
      slug.indexOf('permanentRedirect(')
    );
    expect(slug).toContain("if (isAgentMode) carried.set('mode', 'view');");
    expect(slug).toContain(
      'await agentViewFor(resolvedParams, property.account_id)'
    );
    expect(slug).toContain('agentAudience={agentView}');
    expect(root).toContain('agentAudience={agentView}');
    expect(read('src/lib/showcase/public-data.ts')).toContain(
      '.or(AGENT_VIEW_AUDIENCE_FILTER)'
    );
    for (const route of [
      'src/app/api/public/properties/near/route.ts',
      'src/app/api/public/properties/similar/route.ts',
    ]) {
      expect(read(route)).toContain('.or(AGENT_VIEW_AUDIENCE_FILTER)');
    }
    expect(read('src/components/showcase/showcase-view.tsx')).toContain(
      "if (agentLookups) params.set('mode', 'view');"
    );
    expect(read('src/components/showcase/similar-properties.tsx')).toContain(
      "if (agentMode) params.set('mode', 'view');"
    );
  });
});
