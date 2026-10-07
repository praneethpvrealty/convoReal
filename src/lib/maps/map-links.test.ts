import { describe, it, expect } from 'vitest';
import {
  extractCoordinatesFromMapUrl,
  extractPlaceNameFromMapUrl,
  mapLinkAsPin,
  mapLinkShape,
  propertyMapPin,
} from './map-links';

describe('propertyMapPin', () => {
  it('resolves link and embed from the pin the stored link carries', () => {
    const pin = propertyMapPin({
      google_map_link:
        'https://www.google.com/maps/search/?api=1&query=12.9348,77.6189',
      sublocality: 'Whitefield',
      city: 'Bengaluru',
    });
    expect(pin?.mapUrl).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.9348,77.6189'
    );
    expect(pin?.embedUrl).toContain('q=12.9348,77.6189');
    expect(pin?.embedUrl).toContain('output=embed');
    expect(pin?.embedUrl).not.toContain('Whitefield');
  });

  it('falls back to the stored coordinates when there is no link', () => {
    const pin = propertyMapPin({ latitude: 12.8669, longitude: 77.5565 });
    expect(pin?.coordinates).toEqual({ latitude: 12.8669, longitude: 77.5565 });
    expect(pin?.mapUrl).toContain('12.8669,77.5565');
    expect(pin?.embedUrl).toContain('12.8669,77.5565');
  });

  it('keeps the stored short link as the link that opens', () => {
    // The columns beside an unreadable short link may only hold a
    // geocode of the address, so the saved pin stays authoritative.
    const pin = propertyMapPin({
      google_map_link: 'https://maps.app.goo.gl/abcdef',
      latitude: 12.8669,
      longitude: 77.5565,
    });
    expect(pin?.mapUrl).toBe('https://maps.app.goo.gl/abcdef');
    expect(pin?.embedUrl).toContain('12.8669,77.5565');
  });

  it('survives a map link with malformed percent encoding', () => {
    expect(() =>
      propertyMapPin({ google_map_link: 'https://maps.google.com/maps/%' })
    ).not.toThrow();
    expect(
      propertyMapPin({ google_map_link: 'https://maps.google.com/maps/%' })
        ?.mapUrl
    ).toBe('https://maps.google.com/maps/%');
  });

  it('keeps a short link openable when nothing else is known', () => {
    const pin = propertyMapPin({
      google_map_link: 'https://maps.app.goo.gl/abcdef',
    });
    expect(pin?.mapUrl).toBe('https://maps.app.goo.gl/abcdef');
    expect(pin?.embedUrl).toBeNull();
  });

  it('searches the address when there is no pin at all', () => {
    const pin = propertyMapPin({
      location: '5th Main',
      sublocality: 'HSR Layout',
    });
    expect(pin?.mapUrl).toContain('5th%20Main%2C%20HSR%20Layout');
    expect(pin?.embedUrl).toContain('output=embed');
  });

  it('returns null when the property has no location of any kind', () => {
    expect(propertyMapPin({})).toBeNull();
  });
});

const ROUTE_TO_PLACE =
  'https://www.google.com/maps/dir/12.8411525,77.6401829/Pash+Luxury+Apartments/data=!4m10!4m9!1m1!4e1!1m5!1m4!1s0x3bae6b888a6e94b1:0x1b121bd3b0d39e49!8m2!3d12.863249099999999!4d77.6536115!3e0?utm_source=mstt_0&g_st=aw';
const ROUTE_BETWEEN_PLACES =
  'https://www.google.com/maps/dir/Silk+Board/Chikkathoguru/@12.88,77.63,13z/data=!4m14!4m13!1m5!1m1!1s0x1!2m2!1d77.6227!2d12.9172!1m5!1m1!1s0x2!2m2!1d77.6536!2d12.8632!3e0';
const ROUTE_TO_COORDINATES =
  'https://www.google.com/maps/dir/12.8411525,77.6401829/12.8632491,77.6536115/@12.8521,77.6469,14z';
const STREET_VIEW =
  'https://www.google.com/maps/@12.9347296,77.614563,3a,75y,215.83h,96.36t/data=!3m5!1e1!3m3!1s3l7b-NBY31ZMiyBB2udl1g!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com';

describe('mapLinkShape', () => {
  it('[PRP-042] tells a route and a Street View panorama from a pin', () => {
    expect(mapLinkShape(ROUTE_TO_PLACE)).toBe('directions');
    expect(mapLinkShape(ROUTE_TO_COORDINATES)).toBe('directions');
    expect(
      mapLinkShape(
        'https://maps.google.com/maps?saddr=Silk+Board&daddr=12.8632,77.6536'
      )
    ).toBe('directions');
    expect(mapLinkShape(STREET_VIEW)).toBe('streetview');
    expect(
      mapLinkShape(
        'https://www.google.com/maps/place/Radhe+Medical/@12.8706889,77.5830609,82m/data=!3m1!1e3'
      )
    ).toBe('pin');
    expect(
      mapLinkShape(
        'https://www.google.com/maps/search/?api=1&query=12.8632,77.6536'
      )
    ).toBe('pin');
    expect(mapLinkShape('https://maps.app.goo.gl/F93K1ybtNMMc7Y8k9')).toBe(
      'pin'
    );
  });
});

describe('extractCoordinatesFromMapUrl on a route', () => {
  it('[PRP-042] reads the destination, never the origin or the midpoint viewport', () => {
    expect(extractCoordinatesFromMapUrl(ROUTE_TO_PLACE)).toEqual({
      latitude: 12.863249099999999,
      longitude: 77.6536115,
    });
    expect(extractCoordinatesFromMapUrl(ROUTE_TO_COORDINATES)).toEqual({
      latitude: 12.8632491,
      longitude: 77.6536115,
    });
  });

  it('[PRP-042] takes the last waypoint when both ends are places', () => {
    expect(extractCoordinatesFromMapUrl(ROUTE_BETWEEN_PLACES)).toBeNull();
    expect(extractPlaceNameFromMapUrl(ROUTE_BETWEEN_PLACES)).toBe(
      'Chikkathoguru'
    );
  });

  it('[PRP-042] names the destination of a route without coordinates', () => {
    expect(
      extractPlaceNameFromMapUrl(
        'https://www.google.com/maps/dir/My+Location/Pash+Luxury+Apartments,+Electronic+City/@12.85,77.64,13z'
      )
    ).toBe('Pash Luxury Apartments, Electronic City');
    expect(
      extractCoordinatesFromMapUrl(
        'https://www.google.com/maps/dir/My+Location/Pash+Luxury+Apartments/@12.85,77.64,13z'
      )
    ).toBeNull();
  });
});

describe('mapLinkAsPin', () => {
  it('[PRP-042] reduces a route to a pin on its destination', () => {
    expect(mapLinkAsPin(ROUTE_TO_PLACE)).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.863249099999999,77.6536115'
    );
    expect(mapLinkAsPin(ROUTE_TO_COORDINATES)).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.8632491,77.6536115'
    );
  });

  it('[PRP-042] reduces a Street View panorama to a pin on the camera point', () => {
    expect(mapLinkAsPin(STREET_VIEW)).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.9347296,77.614563'
    );
  });

  it('[PRP-042] searches a named destination that carries no point', () => {
    expect(
      mapLinkAsPin(
        'https://www.google.com/maps/dir/My+Location/Pash+Luxury+Apartments/@12.85,77.64,13z'
      )
    ).toBe(
      'https://www.google.com/maps/search/?api=1&query=Pash%20Luxury%20Apartments'
    );
  });

  it('[PRP-042] leaves a pin link alone', () => {
    expect(
      mapLinkAsPin(
        'https://www.google.com/maps/place/Radhe+Medical/@12.87,77.58,82m/data=!3m1!1e3'
      )
    ).toBeNull();
    expect(
      mapLinkAsPin('https://maps.app.goo.gl/F93K1ybtNMMc7Y8k9')
    ).toBeNull();
  });
});
