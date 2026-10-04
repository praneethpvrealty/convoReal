import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCampaignInsights } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCampaignInsights', () => {
  it('asks Meta for a fixed last-30-days window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            spend: '1500.50',
            impressions: '9000',
            reach: '4000',
            actions: [
              {
                action_type:
                  'onsite_conversion.messaging_conversation_started_7d',
                value: '12',
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const insights = await getCampaignInsights('token', '123');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname.endsWith('/123/insights')).toBe(true);
    expect(url.searchParams.get('date_preset')).toBe('last_30d');
    expect(insights).toEqual({
      spend: 1500.5,
      impressions: 9000,
      reach: 4000,
      conversationsStarted: 12,
    });
  });

  it('returns null when Meta has no rows yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    );
    expect(await getCampaignInsights('token', '123')).toBeNull();
  });
});
