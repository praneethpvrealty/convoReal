import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/public/inquiry AI-agent consent', () => {
  it('rejects an AI-agent enquiry without explicit contact consent', async () => {
    const response = await POST(
      new Request('http://localhost/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          phone: '+919876543210',
          source: 'ai_agent',
          consentToContact: false,
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Explicit consent'),
    });
  });
});
