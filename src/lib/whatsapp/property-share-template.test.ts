import { describe, expect, it } from 'vitest';

// storagePublicUrl builds from this; unset it resolves to a bare path.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

import {
  PROPERTY_SHARE_TEMPLATE_NAMES,
  firstPropertyImage,
  pickPropertyShareTemplate,
  propertyShareParams,
  shareHeaderImage,
} from './property-share-template';
import { PROPERTY_ALERT_TEMPLATE_NAME } from './property-alert-template';
import { PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME } from './property-enquiry-photos-template';

const row = (name: string, category = 'Utility', status = 'APPROVED') => ({
  name,
  status,
  category,
});

const PHOTOS = PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME;
const TEXT = PROPERTY_ALERT_TEMPLATE_NAME;

describe('PROPERTY_SHARE_TEMPLATE_NAMES', () => {
  it('covers both chains, so one query finds every candidate', () => {
    for (const name of [
      PHOTOS,
      'property_enquiry_photos',
      TEXT,
      'property_enquiry_response',
      'new_property_alert',
    ]) {
      expect(PROPERTY_SHARE_TEMPLATE_NAMES, name).toContain(name);
    }
  });
});

describe('pickPropertyShareTemplate', () => {
  it('leads with the photo template when there is an image', () => {
    expect(
      pickPropertyShareTemplate([row(PHOTOS), row(TEXT)], { hasImage: true })?.name,
    ).toBe(PHOTOS);
  });

  it('sends text when there is nothing to lead with', () => {
    expect(
      pickPropertyShareTemplate([row(PHOTOS), row(TEXT)], { hasImage: false })?.name,
    ).toBe(TEXT);
  });

  it('still sends when the photo template is not approved yet', () => {
    // The rename is under review — a share must not wait for it.
    expect(
      pickPropertyShareTemplate([row(PHOTOS, 'Utility', 'PENDING'), row(TEXT)], {
        hasImage: true,
      })?.name,
    ).toBe(TEXT);
  });

  it('uses the photo template rather than nothing when text is missing', () => {
    expect(
      pickPropertyShareTemplate([row(PHOTOS)], { hasImage: false })?.name,
    ).toBe(PHOTOS);
  });

  it('keeps the approved legacy photo name while the branded one is reviewed', () => {
    expect(
      pickPropertyShareTemplate(
        [row(PHOTOS, 'Utility', 'PENDING'), row('property_enquiry_photos')],
        { hasImage: true },
      )?.name,
    ).toBe('property_enquiry_photos');
  });

  it('drops a photo template Meta made Marketing back to Utility text', () => {
    // Marketing is silently dropped at the per-user cap (131049), so a
    // miscategorised rename must never win just for having an image.
    expect(
      pickPropertyShareTemplate([row(PHOTOS, 'Marketing'), row(TEXT, 'Utility')], {
        hasImage: true,
      })?.name,
    ).toBe(TEXT);
  });

  it('never returns an unrelated template', () => {
    // This runs against every template an account owns in the share
    // dialog, so a name outside both chains is not a candidate at all.
    expect(
      pickPropertyShareTemplate([row('some_other_template')], { hasImage: true }),
    ).toBeNull();
  });

  it('is null when nothing is approved', () => {
    expect(
      pickPropertyShareTemplate(
        [row(PHOTOS, 'Utility', 'REJECTED'), row(TEXT, 'Utility', 'PENDING')],
        { hasImage: true },
      ),
    ).toBeNull();
  });
});

describe('firstPropertyImage', () => {
  it('skips the blank strings half-finished edits leave behind', () => {
    expect(firstPropertyImage(['', '   ', 'property-images/a/img-1.jpg'])).toBe(
      'property-images/a/img-1.jpg',
    );
  });

  it('is null for a listing with no photos', () => {
    expect(firstPropertyImage([])).toBeNull();
    expect(firstPropertyImage(null)).toBeNull();
    expect(firstPropertyImage(['', ' '])).toBeNull();
  });
});

describe('shareHeaderImage', () => {
  it('leads with the listing photo over the brand card', () => {
    const out = shareHeaderImage({
      images: ['property-images/a/img-1.jpg'],
      brandImage: 'property-images/a/brand.png',
    });
    expect(out).toContain('img-1.jpg');
    expect(out).not.toContain('brand.png');
  });

  it('falls back to the brand card for a listing with no photos', () => {
    expect(
      shareHeaderImage({ images: [], brandImage: 'property-images/a/brand.png' }),
    ).toContain('brand.png');
  });

  it('is null with neither, so the send keeps the template sample', () => {
    expect(shareHeaderImage({ images: [], brandImage: null })).toBeNull();
    expect(shareHeaderImage({ images: null, brandImage: '  ' })).toBeNull();
  });

  it('returns something Meta can fetch, not a bucket path', () => {
    // Meta fetches the header image itself, so a bucket-relative path
    // would arrive as a broken header rather than no header.
    expect(shareHeaderImage({ images: ['property-images/a/img-1.jpg'] })).toBe(
      'https://test.supabase.co/storage/v1/object/public/property-images/a/img-1.jpg',
    );
  });
});

describe('propertyShareParams', () => {
  const property = {
    id: 'p1',
    title: '3 BHK at Sattva Exotic',
    price: 14582000,
    area_sqft: 1779,
    sublocality: 'Hoodi',
    city: 'Bangalore',
  } as never;

  it('signs the current names with the brokerage as {{2}}', () => {
    for (const name of [PHOTOS, TEXT]) {
      const params = propertyShareParams(name, 'Gopi Krishnan', property, 'Aryavarta Ventures');
      expect(params, name).toHaveLength(5);
      expect(params[1], name).toBe('Aryavarta Ventures');
    }
  });

  it('drops the brokerage for every predecessor', () => {
    // Meta rejects a send whose param count does not match the
    // template, so a spare is not harmless — it fails the send.
    for (const name of [
      'property_enquiry_info',
      'property_enquiry_response',
      'property_enquiry_gallery',
      'property_enquiry_photos',
      'new_property_alert',
    ]) {
      const params = propertyShareParams(name, 'Gopi', property, 'Aryavarta Ventures');
      expect(params, name).toHaveLength(4);
      expect(params[1], name).toBe('3 BHK at Sattva Exotic');
    }
  });

  it('keeps the greeting first on both shapes', () => {
    expect(propertyShareParams(TEXT, 'Gopi Krishnan', property, 'X')[0]).toBe('Gopi');
    expect(
      propertyShareParams('property_enquiry_info', 'Gopi Krishnan', property, 'X')[0],
    ).toBe('Gopi');
  });

  it('signs with the product name rather than sending unsigned', () => {
    // An empty param is rejected by Meta, and an unsigned message is
    // the problem the brokerage param exists to fix.
    const params = propertyShareParams(TEXT, 'Gopi', property, '   ');
    expect(params[1].length).toBeGreaterThan(0);
  });

  it('never returns an empty param on either shape', () => {
    const bare = { id: 'p', title: ' ', price: 0 } as never;
    for (const name of [TEXT, 'property_enquiry_response']) {
      for (const p of propertyShareParams(name, undefined, bare, null)) {
        expect(p.length, name).toBeGreaterThan(0);
      }
    }
  });
});
