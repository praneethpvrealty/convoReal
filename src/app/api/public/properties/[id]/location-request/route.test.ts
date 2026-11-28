import { beforeEach, describe, expect, it, vi } from 'vitest';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROPERTY = '22222222-2222-4222-8222-222222222222';
const BROKER = '33333333-3333-4333-8333-333333333333';

const inserted: Array<Record<string, unknown>> = [];

function chain(table: string) {
  let insertRow: Record<string, unknown> | null = null;
  const result = () => {
    if (table === 'properties') {
      return {
        data: {
          id: PROPERTY,
          title: 'Guarded Building',
          property_code: 'PROP-1',
          user_id: 'user-1',
          is_published: true,
          showcase_visibility: 'public',
        },
        error: null,
      };
    }
    if (table === 'contacts' && !insertRow) {
      return {
        data: { id: BROKER, phone: '+919800000001', classification: 'Agent' },
        error: null,
      };
    }
    if (table === 'property_location_requests' && insertRow) {
      return { data: { id: 'req-1', ...insertRow }, error: null };
    }
    if (table === 'accounts') {
      return { data: { owner_user_id: 'user-1' }, error: null };
    }
    return { data: null, error: null, count: 0 };
  };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'order', 'limit']) {
    q[m] = () => q;
  }
  q.insert = (row: Record<string, unknown>) => {
    insertRow = row;
    if (table === 'property_location_requests') inserted.push(row);
    return q;
  };
  q.maybeSingle = async () => result();
  q.single = async () => result();
  q.then = (resolve: (v: unknown) => void) =>
    resolve(
      table === 'contacts'
        ? { data: [{ id: 'lead-1' }], error: null }
        : { data: null, error: null, count: 0 }
    );
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => chain(t) }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ success: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/conversations/resolve', () => ({
  resolveConversation: vi.fn(async () => ({ conversation: null })),
}));
vi.mock('@/lib/inventory/location-requests', () => ({
  hasReshareLink: vi.fn(async () => false),
  notifyOwnerQueue: vi.fn(async () => undefined),
  requestConsentFromContact: vi.fn(async () => true),
}));
vi.mock('@/lib/showcase/referred-enquiries', () => ({
  isExistingLead: vi.fn(async () => false),
}));

import {
  notifyOwnerQueue,
  requestConsentFromContact,
} from '@/lib/inventory/location-requests';
import { isExistingLead } from '@/lib/showcase/referred-enquiries';
import { POST } from './route';

function post() {
  return POST(
    new Request('http://localhost/api/public/properties/x/location-request', {
      method: 'POST',
      body: JSON.stringify({
        requester_name: 'Manju P',
        requester_phone: '9876543210',
        account_id: ACCOUNT,
        via_contact_id: BROKER,
      }),
    }),
    { params: Promise.resolve({ id: PROPERTY }) }
  );
}

beforeEach(() => {
  inserted.length = 0;
  vi.clearAllMocks();
});

describe('POST /api/public/properties/[id]/location-request', () => {
  it('asks the co-broker first for a requester the account does not know', async () => {
    vi.mocked(isExistingLead).mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(200);
    expect(inserted[0].via_contact_id).toBe(BROKER);
    expect(requestConsentFromContact).toHaveBeenCalledTimes(1);
    expect(notifyOwnerQueue).not.toHaveBeenCalled();
  });

  it('[PRP-070] sends a request from an existing lead straight to the listing side', async () => {
    vi.mocked(isExistingLead).mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(200);
    expect(inserted[0].via_contact_id).toBeNull();
    expect(requestConsentFromContact).not.toHaveBeenCalled();
    expect(notifyOwnerQueue).toHaveBeenCalledTimes(1);
  });
});
