import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseFlyerOptions, formatFlyerPrice } from './flyer-options';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseFlyerOptions', () => {
  it('applies web-dialog defaults to an empty body', () => {
    const parsed = parseFlyerOptions({});
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.options).toMatchObject({
      template: 'minimalist',
      showPrice: true,
      showCode: true,
      showLocation: true,
      showBranding: true,
      brandName: '',
      brandContact: '',
      imageSource: 'original',
      aiImage: null,
      size: 540,
      save: false,
    });
  });

  it('accepts a full valid payload', () => {
    const aiImage = `data:image/jpeg;base64,${'A'.repeat(64)}`;
    const parsed = parseFlyerOptions({
      template: 'vignette',
      show_price: false,
      show_code: false,
      show_location: false,
      show_branding: false,
      brand_name: '  Acme Realty  ',
      brand_contact: '+91 98765 43210',
      image_source: 'ai',
      ai_image: aiImage,
      size: 1080,
    });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.options.template).toBe('vignette');
    expect(parsed.options.showPrice).toBe(false);
    expect(parsed.options.showBranding).toBe(false);
    expect(parsed.options.brandName).toBe('Acme Realty');
    expect(parsed.options.imageSource).toBe('ai');
    expect(parsed.options.aiImage).toBe(aiImage);
    expect(parsed.options.size).toBe(1080);
  });

  it('rejects invalid bodies and malformed ai images', () => {
    expect(parseFlyerOptions(null)).toEqual({ error: 'Invalid request body' });
    expect(parseFlyerOptions('nope')).toEqual({ error: 'Invalid request body' });
    expect(
      parseFlyerOptions({ ai_image: 'https://evil.example/ssrf.png' })
    ).toHaveProperty('error');
    expect(
      parseFlyerOptions({ ai_image: 'data:text/html;base64,PGI+aGk8L2I+' })
    ).toHaveProperty('error');
    expect(
      parseFlyerOptions({ image_source: 'ai' })
    ).toEqual({ error: "'ai_image' is required when image_source is 'ai'" });
  });

  it('accepts a same-project storage public URL as ai_image', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    const url = 'https://proj.supabase.co/storage/v1/object/public/property-images/acc/flyer-bg-1.jpg';
    const parsed = parseFlyerOptions({ image_source: 'ai', ai_image: url });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.options.aiImage).toBe(url);
    expect(
      parseFlyerOptions({ ai_image: 'https://other.supabase.co/storage/v1/object/public/x.jpg' })
    ).toHaveProperty('error');
  });

  it('falls back to defaults for unknown template and size values', () => {
    const parsed = parseFlyerOptions({ template: 'neon', size: 999 });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.options.template).toBe('minimalist');
    expect(parsed.options.size).toBe(540);
  });

  it('forces full resolution when saving', () => {
    const parsed = parseFlyerOptions({ save: true, size: 540 });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.options.save).toBe(true);
    expect(parsed.options.size).toBe(1080);
  });
});

describe('formatFlyerPrice', () => {
  it('formats INR in crores and lakhs like the web canvas', () => {
    expect(formatFlyerPrice(150000000, 'INR')).toBe('₹15 Cr');
    expect(formatFlyerPrice(12500000, 'INR')).toBe('₹1.25 Cr');
    expect(formatFlyerPrice(8500000, 'INR')).toBe('₹85 Lakhs');
    expect(formatFlyerPrice(50000, 'INR')).toBe('₹50,000');
  });

  it('formats other currencies via Intl and survives bad codes', () => {
    expect(formatFlyerPrice(1000, 'USD')).toContain('1,000');
    expect(formatFlyerPrice(1000, 'NOT_A_CODE')).toContain('1,000');
  });
});
