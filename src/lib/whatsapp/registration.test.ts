import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertGraphId,
  checkWhatsAppPermissions,
  getSubscribedApps,
  isGraphId,
  isAbsentOrGraphId,
  registerPhoneNumber,
  sendTextMessage,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from './meta-api';
import { fetchPhoneRegistrationState } from './registration-state';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('registerPhoneNumber', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /{phone_number_id}/register with messaging_product + pin', async () => {
    const result = await registerPhoneNumber({
      phoneNumberId: '1029384756',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result).toEqual({ success: true, alreadyRegistered: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/1029384756/register');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      pin: '123456',
    });
  });

  it('treats "already registered" as success (idempotent re-save)', async () => {
    // This is the silent-failure case we're guarding against — Meta
    // returns 400 + "Phone number is already registered" when the
    // number was previously registered to THIS app. From the user's
    // POV that's the desired outcome, surface it as success.
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, {
        error: {
          message: 'Phone number is already registered to this app.',
          code: 133005,
        },
      })
    );
    const result = await registerPhoneNumber({
      phoneNumberId: '1029384756',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result).toEqual({ success: true, alreadyRegistered: true });
  });

  it("surfaces Meta's PIN-required error verbatim so the UI can show it", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, {
        error: {
          message:
            'Two-step verification PIN required. Set one in Meta WhatsApp Manager → Two-step verification.',
          code: 133007,
        },
      })
    );
    await expect(
      registerPhoneNumber({
        phoneNumberId: '1029384756',
        accessToken: 't',
        pin: '000000',
      })
    ).rejects.toThrow(/Two-step verification PIN required/);
  });

  it('surfaces generic Meta errors as throw', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(500, {
        error: { message: 'Internal Meta error' },
      })
    );
    await expect(
      registerPhoneNumber({
        phoneNumberId: '1029384756',
        accessToken: 't',
        pin: '123456',
      })
    ).rejects.toThrow(/Internal Meta error/);
  });
});

describe('subscribeWabaToApp', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /{waba_id}/subscribed_apps with bearer token', async () => {
    await subscribeWabaToApp({ wabaId: '5647382910', accessToken: 'tok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/5647382910/subscribed_apps');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(403, { error: { message: 'Insufficient permissions' } })
    );
    await expect(
      subscribeWabaToApp({ wabaId: '5647382910', accessToken: 'tok' })
    ).rejects.toThrow(/Insufficient permissions/);
  });
});

describe('getSubscribedApps', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the list of subscribed apps', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            whatsapp_business_api_data: {
              id: 'APP1',
              name: 'ConvoReal',
              link: 'https://example.com/app',
            },
          },
        ],
      })
    );
    const apps = await getSubscribedApps({
      wabaId: '5647382910',
      accessToken: 'tok',
    });
    expect(apps).toHaveLength(1);
    expect(apps[0].whatsapp_business_api_data?.name).toBe('ConvoReal');
  });

  it('returns empty array when Meta returns no data field', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    const apps = await getSubscribedApps({
      wabaId: '5647382910',
      accessToken: 'tok',
    });
    expect(apps).toEqual([]);
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(401, { error: { message: 'Invalid OAuth token' } })
    );
    await expect(
      getSubscribedApps({ wabaId: '5647382910', accessToken: 'tok' })
    ).rejects.toThrow(/Invalid OAuth token/);
  });
});

describe('[WAN-007] Graph id validation', () => {
  const malformed = [
    '123/../456',
    '123?fields=access_token',
    '123#',
    'me',
    ' 123',
    '123 ',
    '12a3',
    '',
  ];
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ id: '1029384756' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts digit-only ids and returns them unchanged', () => {
    expect(isGraphId('1029384756')).toBe(true);
    expect(assertGraphId('1029384756', 'Phone Number ID')).toBe('1029384756');
  });

  it.each(malformed)('rejects %j', (id) => {
    expect(isGraphId(id)).toBe(false);
    expect(() => assertGraphId(id, 'Phone Number ID')).toThrow(
      'Phone Number ID must contain digits only.'
    );
  });

  it('treats an omitted or cleared id as absent, and nothing else', () => {
    for (const absent of [undefined, null, '']) {
      expect(isAbsentOrGraphId(absent)).toBe(true);
    }
    expect(isAbsentOrGraphId('1029384756')).toBe(true);
    for (const wrong of [0, false, 1029384756, {}, [], ' ', ' 123', 'waba-1']) {
      expect(isAbsentOrGraphId(wrong)).toBe(false);
    }
  });

  it('rejects a value that is not a string', () => {
    expect(isGraphId(1029384756)).toBe(false);
    expect(() =>
      assertGraphId(1029384756 as unknown as string, 'Phone Number ID')
    ).toThrow(/digits only/);
  });

  it.each(malformed)(
    'never calls Meta for a malformed phone number id %j',
    async (id) => {
      await expect(
        verifyPhoneNumber({ phoneNumberId: id, accessToken: 'tok' })
      ).rejects.toThrow(/Phone Number ID must contain digits only/);
      await expect(
        registerPhoneNumber({
          phoneNumberId: id,
          accessToken: 'tok',
          pin: '123456',
        })
      ).rejects.toThrow(/Phone Number ID must contain digits only/);
      await expect(
        fetchPhoneRegistrationState({ phoneNumberId: id, accessToken: 'tok' })
      ).resolves.toBeNull();
      await expect(
        sendTextMessage({
          phoneNumberId: id,
          accessToken: 'tok',
          to: '919900000000',
          text: 'hello',
        })
      ).rejects.toThrow(/Phone Number ID must contain digits only/);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(malformed)(
    'never calls Meta for a malformed WABA id %j',
    async (id) => {
      await expect(
        subscribeWabaToApp({ wabaId: id, accessToken: 'tok' })
      ).rejects.toThrow(
        /WhatsApp Business Account ID must contain digits only/
      );
      await expect(
        getSubscribedApps({ wabaId: id, accessToken: 'tok' })
      ).rejects.toThrow(
        /WhatsApp Business Account ID must contain digits only/
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('reports a malformed WABA id as a permission issue without requesting it', async () => {
    const result = await checkWhatsAppPermissions('tok', '123/../456');
    expect(result.issues).toContain('Failed to verify WABA access');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('456'))).toBe(false);
  });

  it('still verifies a numeric phone number id', async () => {
    const info = await verifyPhoneNumber({
      phoneNumberId: '1029384756',
      accessToken: 'tok',
    });
    expect(info.id).toBe('1029384756');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/1029384756?fields=id'
    );
  });
});
