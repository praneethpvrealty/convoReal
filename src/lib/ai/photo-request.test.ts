import { describe, it, expect, vi, beforeEach } from 'vitest';

// The photo-request detector and sender. The detector is the router:
// it decides between the qualification ladder standing down and the
// listing's own photos going out, so the real messages from both
// failures are pinned here verbatim.

const sendWhatsAppMessageAndPersist = vi.fn();
const accountPropertyShowcaseUrl = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountPropertyShowcaseUrl: (...args: unknown[]) =>
    accountPropertyShowcaseUrl(...args),
}));

const {
  requestsPropertyPhotos,
  photoHandoverText,
  buildPhotoReplyText,
  sendSubjectPhotos,
} = await import('./photo-request');

describe('requestsPropertyPhotos', () => {
  it.each([
    'Sir can I get images  images',
    'Can you send photos?',
    'send pics of the villa',
    'pics please',
    'Photos',
    'images?',
    'I want to see more photos',
    'show me the video',
    'can you share some pictures',
    'any snaps of the interior',
  ])('asks for media: %s', (text) => {
    expect(requestsPropertyPhotos(text)).toBe(true);
  });

  it.each([
    // Offering media, not asking for it — owner intake owns these.
    'I want to add photos to my listing',
    'uploaded the pics for the plot',
    // Confirming receipt, not asking.
    'I have sent the photos',
    'Images are here. Pls let me know if you are still not able to get it',
    // Requirements and ordinary chat.
    'Looking for industrial / commercial lands around the peripherals',
    'budget is 2 cr now',
    'call me',
    'What is the price?',
    'Can we visit tomorrow?',
    '',
  ])('does not fire on: %s', (text) => {
    expect(requestsPropertyPhotos(text)).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(requestsPropertyPhotos(null)).toBe(false);
    expect(requestsPropertyPhotos(undefined)).toBe(false);
  });
});

describe('photoHandoverText', () => {
  it('names the listing when one is pinned to the thread', () => {
    expect(photoHandoverText('Bilekahalli 60x40 Plot')).toContain(
      '*Bilekahalli 60x40 Plot*'
    );
  });

  it('still promises the photos when no listing is pinned', () => {
    expect(photoHandoverText(null)).toMatch(/photos/i);
  });
});

describe('buildPhotoReplyText', () => {
  it('links the full gallery when the reply left photos out', () => {
    const text = buildPhotoReplyText([
      { title: 'Bilekahalli Plot', sent: 4, total: 9, url: 'https://x/p1' },
    ]);
    expect(text).toContain('*Bilekahalli Plot*');
    expect(text).toContain('All 9 photos');
    expect(text).toContain('https://x/p1');
  });

  it('uses the singular for one photo', () => {
    const text = buildPhotoReplyText([
      { title: 'Bilekahalli Plot', sent: 1, total: 1, url: 'https://x/p1' },
    ]);
    expect(text).toContain("Here's a photo");
  });

  it('lists one link per listing for a multi-subject reply', () => {
    const text = buildPhotoReplyText([
      { title: 'Plot A', sent: 2, total: 2, url: 'https://x/a' },
      { title: 'Plot B', sent: 2, total: 5, url: 'https://x/b' },
    ]);
    expect(text).toContain('*Plot A*: https://x/a');
    expect(text).toContain('*Plot B*: https://x/b');
  });
});

describe('sendSubjectPhotos', () => {
  const property = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    title: 'Bilekahalli Plot',
    images: ['https://img/1.jpg', 'https://img/2.jpg'],
    property_code: 'PC-1',
    video_url: null,
    video_status: null,
    ...overrides,
  });

  let rows: unknown[] = [];

  const db = {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.in = async () => ({ data: rows });
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const run = (propertyIds: string[], requestText = 'can I get images') =>
    sendSubjectPhotos({
      db,
      accountId: 'acct-1',
      userId: 'owner-1',
      contactId: 'c1',
      conversationId: 'conv-1',
      propertyIds,
      requestText,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
    accountPropertyShowcaseUrl.mockResolvedValue(
      'https://acme/?property_id=PC-1'
    );
    rows = [property()];
  });

  it('sends the photos, captions only the first, and closes with the link', async () => {
    const sent = await run(['p1']);

    expect(sent).toBe(true);
    const calls = sendWhatsAppMessageAndPersist.mock.calls.map((c) => c[0]);
    const media = calls.filter((c) => c.kind === 'media');
    expect(media).toHaveLength(2);
    expect(media[0].mediaCaption).toContain('*Bilekahalli Plot*');
    expect(media[1].mediaCaption).toBeUndefined();
    const closing = calls.find((c) => c.kind === 'text');
    expect(closing?.text).toContain('https://acme/?property_id=PC-1');
  });

  it('caps a single subject at four photos and says how many the gallery holds', async () => {
    rows = [
      property({
        images: [1, 2, 3, 4, 5, 6].map((n) => `https://img/${n}.jpg`),
      }),
    ];

    await run(['p1']);

    const calls = sendWhatsAppMessageAndPersist.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c.kind === 'media')).toHaveLength(4);
    expect(calls.find((c) => c.kind === 'text')?.text).toContain(
      'All 6 photos'
    );
  });

  it('halves the cap when the buyer asked about several listings', async () => {
    rows = [
      property({
        images: ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg'],
      }),
      property({
        id: 'p2',
        title: 'JP Nagar Plot',
        images: ['https://img/4.jpg', 'https://img/5.jpg', 'https://img/6.jpg'],
      }),
    ];

    await run(['p1', 'p2']);

    const calls = sendWhatsAppMessageAndPersist.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c.kind === 'media')).toHaveLength(4);
  });

  it('returns false when the subject has no public photos', async () => {
    rows = [property({ images: [] })];

    expect(await run(['p1'])).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('returns false when no subject was resolved', async () => {
    expect(await run([])).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('returns false when every send fails, so the caller hands over', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: false });

    expect(await run(['p1'])).toBe(false);
    const calls = sendWhatsAppMessageAndPersist.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.kind === 'media')).toBe(true);
  });

  it('adds the listing video only when it was asked for and is ready', async () => {
    rows = [
      property({ video_url: 'https://vid/1.mp4', video_status: 'ready' }),
    ];

    await run(['p1'], 'can I get the video and photos');
    let calls = sendWhatsAppMessageAndPersist.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.mediaKind === 'video')).toBe(true);

    vi.clearAllMocks();
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
    accountPropertyShowcaseUrl.mockResolvedValue(
      'https://acme/?property_id=PC-1'
    );

    await run(['p1'], 'can I get photos');
    calls = sendWhatsAppMessageAndPersist.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.mediaKind === 'video')).toBe(false);
  });
});
