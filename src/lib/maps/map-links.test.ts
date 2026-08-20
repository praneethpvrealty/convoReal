import { describe, it, expect } from 'vitest';
import { propertyMapPin } from './map-links';

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

  it('falls back to the stored coordinates when the link has none', () => {
    const pin = propertyMapPin({
      google_map_link: 'https://maps.app.goo.gl/abcdef',
      latitude: 12.8669,
      longitude: 77.5565,
    });
    expect(pin?.coordinates).toEqual({ latitude: 12.8669, longitude: 77.5565 });
    expect(pin?.mapUrl).toContain('12.8669,77.5565');
    expect(pin?.embedUrl).toContain('12.8669,77.5565');
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
