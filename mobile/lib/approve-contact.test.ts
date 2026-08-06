import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The approve flow's contract with POST /api/contacts/[id]/approve.
 *
 * The orchestration this used to cover — the status flip, the drafted
 * details, the conversation lookup — moved into the route, so what is
 * worth pinning here is the mapping: which server fields become which
 * outcome, and which failures the caller may safely retry.
 *
 * `api` is mocked so the module loads under the plain Node runner
 * (importing it for real reaches for EXPO_PUBLIC_* config).
 */

let response: unknown;
let thrown: Error | null;
let calls: { path: string; init?: { method?: string } }[];

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

vi.mock('./api', () => ({
  ApiError: FakeApiError,
  apiFetch: async (path: string, init?: { method?: string }) => {
    calls.push({ path, init });
    if (thrown) throw thrown;
    return response;
  },
}));

vi.mock('./supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('./welcome-message', () => ({ getShowcaseUrl: async () => 'https://showcase.test' }));

import type { Contact } from './types';

const { approveAndSendDetails } = await import('./approve-contact');

const CONTACT: Contact = {
  id: 'contact-1',
  name: 'Veena Gupta',
  phone: '+919415224490',
  last_inquired_property_id: 'prop-1',
} as Contact;

const PROPERTY = { id: 'prop-1', title: '50x80 Residential Plot in BTM Layout' };

beforeEach(() => {
  calls = [];
  thrown = null;
  response = {
    data: {
      approved: true,
      sent: true,
      channel: 'freeform',
      property: PROPERTY,
      details_message: 'Here are the complete details for the property "50x80 Residential Plot in BTM Layout"',
      conversation_id: 'conv-1',
    },
  };
});

describe('approveAndSendDetails', () => {
  it('approves in a single POST and reports how the details went out', async () => {
    const result = await approveAndSendDetails(CONTACT);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/contacts/contact-1/approve');
    expect(calls[0].init?.method).toBe('POST');
    expect(result).toMatchObject({ ok: true, sent: true, channel: 'freeform' });
  });

  it('surfaces a failed approval as retryable, having sent nothing', async () => {
    thrown = new FakeApiError(500, 'row level security');

    const result = await approveAndSendDetails(CONTACT);

    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.error).toBe('row level security');
  });

  it('still activates a contact that inquired about nothing', async () => {
    response = { data: { approved: true, sent: false } };

    const result = await approveAndSendDetails(CONTACT);

    expect(result).toMatchObject({ ok: true, sent: false });
    expect(result.reengageConversationId).toBeUndefined();
  });

  it('hands back the conversation for a template when the window has closed', async () => {
    response = {
      data: {
        approved: true,
        sent: false,
        property: PROPERTY,
        details_message: 'details for 50x80 Residential Plot in BTM Layout',
        conversation_id: 'conv-1',
        template_status: 'NONE',
      },
    };

    const result = await approveAndSendDetails(CONTACT);

    expect(result).toMatchObject({ ok: true, sent: false, reengageConversationId: 'conv-1' });
    expect(result.detailsMessage).toContain('50x80 Residential Plot in BTM Layout');
  });

  it('does not offer a re-engage thread when the details actually went out', async () => {
    const result = await approveAndSendDetails(CONTACT);

    expect(result.sent).toBe(true);
    expect(result.reengageConversationId).toBeUndefined();
  });

  it('reports a send failure without failing the approval, so no retry re-sends', async () => {
    response = {
      data: {
        approved: true,
        sent: false,
        property: PROPERTY,
        conversation_id: null,
        send_error: 'Contact phone invalid format',
      },
    };

    const result = await approveAndSendDetails(CONTACT);

    expect(result.ok).toBe(true);
    expect(result.error).toBe('Contact phone invalid format');
    expect(result.reengageConversationId).toBeUndefined();
  });
});
