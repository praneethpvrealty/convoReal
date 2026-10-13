import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A personal-WhatsApp share logged from the share sheet. The ledger call
 * used to sit behind `profile.account_id` read off the auth store, so a
 * session whose launch-time profile fetch had failed shared the listing,
 * made no request at all, and reported "Not recorded" — the share in
 * praneethpvrealty/convoReal PROP-2199 on 13 Oct 2026. The ledger is now
 * posted first and unconditionally; only the timeline note needs the
 * profile, and that is loaded on demand.
 */

const writes: Array<{ table: string; row: Record<string, unknown> }> = [];

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
  isTimeout: () => false,
  isRateLimited: () => false,
}));
vi.mock('./auth-store', () => ({
  ensureProfile: vi.fn(),
  currentUserId: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => ({
        eq: async () => {
          writes.push({ table, row });
          return { data: null, error: null };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        writes.push({ table, row });
        return { data: null, error: null };
      },
    }),
  },
}));

const { apiFetch } = await import('./api');
const { ensureProfile, currentUserId } = await import('./auth-store');
const { logExternalShare } = await import('./property-share-actions');

type Contact = Parameters<typeof logExternalShare>[0];
type Property = Parameters<typeof logExternalShare>[1];

const contact = { id: 'c1', classification: 'Buyer' } as Contact;
const property = {
  id: 'p1',
  property_code: 'PROP-2199',
  title: 'Commercial 50x80 Old House',
} as Property;

beforeEach(() => {
  writes.length = 0;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(ensureProfile).mockReset();
  vi.mocked(currentUserId).mockReset();
});

describe('[JRN-021] logExternalShare', () => {
  it('records the share on the ledger even when the profile has not loaded', async () => {
    vi.mocked(ensureProfile).mockResolvedValue(null);
    vi.mocked(currentUserId).mockResolvedValue(null);
    vi.mocked(apiFetch).mockResolvedValue({
      data: { recorded: 1, failed: [] },
    });

    await expect(logExternalShare(contact, property)).resolves.toBe(true);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(path).toBe('/api/properties/share-log');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      property_id: 'p1',
      recipients: [{ contact_id: 'c1', classification: 'Buyer' }],
      channel: 'whatsapp',
    });
    expect(writes).toEqual([]);
  });

  it('writes the timeline note once the profile is loaded on demand', async () => {
    vi.mocked(ensureProfile).mockResolvedValue({
      account_id: 'acc-1',
      account_role: 'owner',
    });
    vi.mocked(currentUserId).mockResolvedValue('u1');
    vi.mocked(apiFetch).mockResolvedValue({
      data: { recorded: 1, failed: [] },
    });

    await expect(logExternalShare(contact, property)).resolves.toBe(true);

    expect(writes.map((w) => w.table).sort()).toEqual([
      'contact_notes',
      'contacts',
    ]);
    const note = writes.find((w) => w.table === 'contact_notes')?.row;
    expect(note).toMatchObject({
      contact_id: 'c1',
      user_id: 'u1',
      account_id: 'acc-1',
      note_text:
        '📱 Shared via personal WhatsApp\n🏠 Property: [PROP-2199] Commercial 50x80 Old House',
    });
  });

  it('reports the share as unrecorded only when the server never records it', async () => {
    vi.mocked(ensureProfile).mockResolvedValue(null);
    vi.mocked(currentUserId).mockResolvedValue(null);
    vi.mocked(apiFetch).mockResolvedValue({
      data: { recorded: 0, failed: ['c1'] },
    });

    await expect(logExternalShare(contact, property)).resolves.toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });
});
