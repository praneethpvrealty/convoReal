import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ apiBase: () => 'https://app.example.com' }));
vi.mock('./env', () => ({
  ENV: { supabaseUrl: 'https://proj.supabase.co' },
}));

const { mediaSource, mediaCacheFileName } = await import('./media-source');

describe('mediaSource', () => {
  it('sends inbound Meta media through the auth-gated proxy', () => {
    expect(mediaSource('/api/whatsapp/media/wamid.123')).toEqual({
      kind: 'proxy',
      uri: 'https://app.example.com/api/whatsapp/media/wamid.123',
      path: '/api/whatsapp/media/wamid.123',
    });
  });

  it('resolves an outbound storage path on the storage host, not the app', () => {
    const source = mediaSource('chat-media/acct-1/chat-123.jpg');
    expect(source?.kind).toBe('public');
    expect(source?.uri).toBe(
      'https://proj.supabase.co/storage/v1/object/public/chat-media/acct-1/chat-123.jpg'
    );
  });

  it('re-bases an absolute storage URL from an older project ref', () => {
    const source = mediaSource(
      'https://old-ref.supabase.co/storage/v1/object/public/chat-media/a/b.jpg'
    );
    expect(source).toEqual({
      kind: 'public',
      uri: 'https://proj.supabase.co/storage/v1/object/public/chat-media/a/b.jpg',
    });
  });

  it('treats any other relative path as ours rather than pointing it at storage', () => {
    expect(mediaSource('/api/legacy/media/9')?.kind).toBe('proxy');
  });

  it('is null for a message with no media', () => {
    expect(mediaSource(null)).toBeNull();
    expect(mediaSource(undefined)).toBeNull();
    expect(mediaSource('   ')).toBeNull();
  });

  it('never marks a storage object as needing auth headers', () => {
    // A bearer token on a cross-origin storage request is both useless
    // and a token leak to another host.
    expect(mediaSource('chat-media/a/b.jpg')?.kind).toBe('public');
  });
});

describe('mediaCacheFileName', () => {
  it('names a proxied image after its media path and type', () => {
    expect(
      mediaCacheFileName('/api/whatsapp/media/1234567890', 'image/jpeg')
    ).toBe('wa-api_whatsapp_media_1234567890.jpg');
  });

  it('keeps nothing from the path that could leave the cache directory', () => {
    const name = mediaCacheFileName('/api/whatsapp/media/../../x', 'image/png');
    expect(name).not.toContain('/');
    expect(name.endsWith('.png')).toBe(true);
  });

  it('names a voice note after its audio type', () => {
    expect(
      mediaCacheFileName('/api/whatsapp/media/77', 'audio/ogg; codecs=opus')
    ).toBe('wa-api_whatsapp_media_77.ogg');
  });

  it('falls back to a neutral extension for an unknown type', () => {
    expect(
      mediaCacheFileName('/api/whatsapp/media/9', 'application/octet-stream')
    ).toBe('wa-api_whatsapp_media_9.img');
  });
});

describe('every message-media renderer resolves through mediaSource', () => {
  const renderers = [
    'components/media-image.tsx',
    'components/audio-bubble.tsx',
    'components/message-bubble.tsx',
  ];

  for (const file of renderers) {
    it(`[INB-013] ${file} asks mediaSource where the media lives`, async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      expect(source).toContain('mediaSource');
      expect(source).not.toMatch(/\$\{apiBase\(\)\}/);
      expect(source).not.toContain('absoluteMediaUrl');
    });
  }
});
