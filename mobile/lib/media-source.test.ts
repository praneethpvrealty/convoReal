import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ apiBase: () => 'https://app.example.com' }));
vi.mock('./env', () => ({
  ENV: { supabaseUrl: 'https://proj.supabase.co' },
}));

const { mediaSource } = await import('./media-source');

describe('mediaSource', () => {
  it('sends inbound Meta media through the auth-gated proxy', () => {
    expect(mediaSource('/api/whatsapp/media/wamid.123')).toEqual({
      kind: 'proxy',
      uri: 'https://app.example.com/api/whatsapp/media/wamid.123',
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
