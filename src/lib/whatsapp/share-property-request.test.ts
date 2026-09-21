import { describe, expect, it, vi } from 'vitest';
import { postPropertyShare } from './share-property-request';

const body = { contact_id: 'c1', property_id: 'p1', message: 'hi' };

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('postPropertyShare', () => {
  it('returns the server verdict without retrying on a normal response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: { sent: true, channel: 'template' } }));
    const sleep = vi.fn(async () => {});
    const result = await postPropertyShare(body, { fetchImpl, sleep });
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { sent: true, channel: 'template' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits out a 429 for retry_after_seconds and sends again', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'Rate limit exceeded', retry_after_seconds: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { sent: true } }));
    const sleep = vi.fn(async () => {});
    const result = await postPropertyShare(body, { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(12_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.data?.sent).toBe(true);
  });

  it('caps the wait at the limiter window and gives up after a second 429', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: 'Rate limit exceeded', retry_after_seconds: 600 })
    );
    const sleep = vi.fn(async () => {});
    const result = await postPropertyShare(body, { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(70_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false, status: 429, error: 'Rate limit exceeded' });
  });

  it('waits a full minute when the 429 carries no retry hint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { sent: false, template_status: 'PENDING' } }));
    const sleep = vi.fn(async () => {});
    const result = await postPropertyShare(body, { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(result.data?.template_status).toBe('PENDING');
  });

  it('surfaces a non-429 failure with the server error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: 'Contact not found' }));
    const result = await postPropertyShare(body, { fetchImpl, sleep: async () => {} });
    expect(result).toMatchObject({ ok: false, status: 404, error: 'Contact not found' });
  });
});
