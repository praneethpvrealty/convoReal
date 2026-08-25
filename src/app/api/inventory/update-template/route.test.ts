import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount,
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));

import { GET } from './route';
import { INVENTORY_UPDATE_TEMPLATE_NAME } from '@/lib/whatsapp/inventory-update-template';

describe('/api/inventory/update-template', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serves the same definition the web dialog submits', async () => {
    getCurrentAccount.mockResolvedValue({ accountId: 'acc-1' });
    const response = await GET(
      new Request('https://app.convoreal.test/api/inventory/update-template')
    );
    const body = (await response.json()) as {
      data: {
        name: string;
        category: string;
        buttons: { type: string; url?: string }[];
      };
    };
    expect(body.data.name).toBe(INVENTORY_UPDATE_TEMPLATE_NAME);
    expect(body.data.category).toBe('Marketing');
    const urlButton = body.data.buttons.find((b) => b.type === 'URL');
    expect(urlButton?.url).toContain('/{{1}}');
  });

  it('refuses an unauthenticated caller', async () => {
    getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));
    const response = await GET(
      new Request('https://app.convoreal.test/api/inventory/update-template')
    );
    expect(response.status).toBe(401);
  });
});
