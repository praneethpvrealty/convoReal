import { describe, it, expect, beforeEach } from 'vitest';
import { storagePublicUrl, storageObjectPath } from './url';

const NEW = 'https://newref.supabase.co';
const OLD = 'https://cvmgojajtegbuuujtptn.supabase.co';
const PUB = '/storage/v1/object/public/';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = NEW;
});

describe('storagePublicUrl', () => {
  it('builds a URL from a bucket-relative path', () => {
    expect(storagePublicUrl('property-images/acc/img.jpg')).toBe(
      `${NEW}${PUB}property-images/acc/img.jpg`,
    );
  });

  it('tolerates a leading slash on the path', () => {
    expect(storagePublicUrl('/property-images/acc/img.jpg')).toBe(
      `${NEW}${PUB}property-images/acc/img.jpg`,
    );
  });

  it('re-bases a legacy absolute URL from an old project ref onto the current host', () => {
    expect(storagePublicUrl(`${OLD}${PUB}property-images/acc/img.jpg`)).toBe(
      `${NEW}${PUB}property-images/acc/img.jpg`,
    );
  });

  it('re-bases the render/transform URL form and preserves the query', () => {
    const render = `${OLD}/storage/v1/render/image/public/property-images/acc/img.jpg?width=160`;
    expect(storagePublicUrl(render)).toBe(
      `${NEW}/storage/v1/render/image/public/property-images/acc/img.jpg?width=160`,
    );
  });

  it('leaves an external absolute URL untouched', () => {
    const ext = 'https://pps.whatsapp.net/v/t61/avatar.jpg';
    expect(storagePublicUrl(ext)).toBe(ext);
  });

  it('passes through data: and blob: URLs', () => {
    expect(storagePublicUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(storagePublicUrl('blob:abc')).toBe('blob:abc');
  });

  it('returns empty string for nullish/empty input', () => {
    expect(storagePublicUrl(null)).toBe('');
    expect(storagePublicUrl(undefined)).toBe('');
    expect(storagePublicUrl('   ')).toBe('');
  });
});

describe('storageObjectPath', () => {
  it('extracts the bucket-relative path from an absolute URL', () => {
    expect(storageObjectPath(`${OLD}${PUB}property-images/acc/img.jpg`)).toBe(
      'property-images/acc/img.jpg',
    );
  });

  it('strips a query string', () => {
    expect(storageObjectPath(`${NEW}${PUB}property-images/acc/img.jpg?token=x`)).toBe(
      'property-images/acc/img.jpg',
    );
  });

  it('returns a relative path unchanged', () => {
    expect(storageObjectPath('property-images/acc/img.jpg')).toBe('property-images/acc/img.jpg');
  });

  it('returns null for an external URL', () => {
    expect(storageObjectPath('https://pps.whatsapp.net/v/avatar.jpg')).toBeNull();
  });

  it('returns null for nullish input', () => {
    expect(storageObjectPath(null)).toBeNull();
    expect(storageObjectPath('')).toBeNull();
  });
});
