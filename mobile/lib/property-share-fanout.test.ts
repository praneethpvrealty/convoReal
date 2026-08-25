import { describe, expect, it, vi } from 'vitest';

/**
 * The Engine fan-out behind the property share sheet. A 31-contact list
 * used to be sent one call at a time on the default 20-second request
 * budget: every send after the first was abandoned mid-flight and
 * reported as a failure. The pool bounds how many run at once, and a
 * per-recipient verdict is kept so a closed window, an abandoned request
 * and a refusal stay distinguishable.
 */

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
  isTimeout: () => false,
}));
vi.mock('./auth-store', () => ({ useAuthStore: { getState: () => ({}) } }));
vi.mock('./supabase', () => ({ supabase: {} }));

const { apiFetch } = await import('./api');
const { sendPropertyViaEngineMany } = await import('./property-share-actions');

type Contact = Parameters<typeof sendPropertyViaEngineMany>[0][number];

function contacts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `C${i}`,
  })) as Contact[];
}

const property = { id: 'p1' } as Parameters<
  typeof sendPropertyViaEngineMany
>[1];

describe('sendPropertyViaEngineMany', () => {
  it('keeps at most four sends in flight and reports every recipient', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(apiFetch).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { data: { sent: true, conversation_id: null } };
    });

    const outcomes = await sendPropertyViaEngineMany(
      contacts(31),
      property,
      () => 'hi'
    );

    expect(outcomes.size).toBe(31);
    expect([...outcomes.values()].every((o) => o.sent)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('reports progress as each recipient lands', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: { sent: true, conversation_id: null },
    });
    const seen: number[] = [];

    await sendPropertyViaEngineMany(
      contacts(5),
      property,
      () => 'hi',
      (done) => seen.push(done)
    );

    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not let one blocked window fail the rest', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      const body = JSON.parse(String((init as { body: string }).body)) as {
        contact_id: string;
      };
      return body.contact_id === 'c1'
        ? { data: { sent: false, template_status: 'PENDING' } }
        : { data: { sent: true, conversation_id: null } };
    });

    const outcomes = await sendPropertyViaEngineMany(
      contacts(3),
      property,
      () => 'hi'
    );

    expect(outcomes.get('c1')?.templateStatus).toBe('PENDING');
    expect(outcomes.get('c0')?.sent).toBe(true);
    expect(outcomes.get('c2')?.sent).toBe(true);
  });
});
