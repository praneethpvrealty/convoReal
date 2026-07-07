import { describe, expect, it } from 'vitest';
import { haversineKm, boundingBox } from './geo';

// Reference localities in Bengaluru
const HSR = { lat: 12.9121, lng: 77.6446 };
const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
const WHITEFIELD = { lat: 12.9698, lng: 77.7500 };

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(HSR.lat, HSR.lng, HSR.lat, HSR.lng)).toBe(0);
  });

  it('measures HSR → Koramangala at roughly 3.4 km', () => {
    const d = haversineKm(HSR.lat, HSR.lng, KORAMANGALA.lat, KORAMANGALA.lng);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(4.5);
  });

  it('measures HSR → Whitefield at roughly 13 km', () => {
    const d = haversineKm(HSR.lat, HSR.lng, WHITEFIELD.lat, WHITEFIELD.lng);
    expect(d).toBeGreaterThan(11);
    expect(d).toBeLessThan(15);
  });

  it('is symmetric', () => {
    const ab = haversineKm(HSR.lat, HSR.lng, WHITEFIELD.lat, WHITEFIELD.lng);
    const ba = haversineKm(WHITEFIELD.lat, WHITEFIELD.lng, HSR.lat, HSR.lng);
    expect(ab).toBeCloseTo(ba, 10);
  });
});

describe('boundingBox', () => {
  it('contains the full radius circle', () => {
    const radiusKm = 5;
    const box = boundingBox(HSR.lat, HSR.lng, radiusKm);

    // Points exactly at the circle's cardinal extremes must be inside the box
    const north = { lat: HSR.lat + radiusKm / 111.32, lng: HSR.lng };
    const east = {
      lat: HSR.lat,
      lng: HSR.lng + radiusKm / (111.32 * Math.cos((HSR.lat * Math.PI) / 180)),
    };
    expect(north.lat).toBeLessThanOrEqual(box.maxLat);
    expect(east.lng).toBeLessThanOrEqual(box.maxLng);
    expect(box.minLat).toBeLessThan(HSR.lat);
    expect(box.minLng).toBeLessThan(HSR.lng);
  });

  it('excludes points beyond the radius after haversine check', () => {
    const box = boundingBox(HSR.lat, HSR.lng, 5);
    // Whitefield (~13 km away) is outside a 5 km box
    const insideBox =
      WHITEFIELD.lat >= box.minLat &&
      WHITEFIELD.lat <= box.maxLat &&
      WHITEFIELD.lng >= box.minLng &&
      WHITEFIELD.lng <= box.maxLng;
    expect(insideBox).toBe(false);
  });
});
