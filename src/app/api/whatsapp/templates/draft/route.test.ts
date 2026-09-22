import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNumberChangeTemplatePayload } from '@/lib/whatsapp/number-change-template';

/**
 * POST /api/whatsapp/templates/draft — the local half of the
 * translation gate. The draft wears the category it will be submitted
 * under, which is Meta's once any language of the name has reached it.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let inserts: Array<{ table: string; row: Record<string, unknown> }>;

function next(table: string): QueuedResponse {
  return (queues[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        insert: (row: unknown) => {
          inserts.push({ table, row: row as Record<string, unknown> });
          return builder;
        },
        single: () => Promise.resolve(next(table)),
        maybeSingle: () => Promise.resolve(next(table)),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(next(table)).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireOrgRole: async () => ({
    supabase: makeDb(),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/whatsapp/template-showcase-buttons', () => ({
  withAccountShowcaseButtons: async (
    _db: unknown,
    _account: string,
    payload: unknown
  ) => payload,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

import { POST } from './route';

function makeRequest(body: unknown) {
  return new Request('http://test/api/whatsapp/templates/draft', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  queues = {};
  inserts = [];
});

describe('POST /api/whatsapp/templates/draft', () => {
  it('[CLG-003] drafts a translation under the category Meta holds for the name', async () => {
    queues['message_templates'] = [
      { data: null },
      {
        data: [
          {
            category: 'Marketing',
            meta_template_id: 'meta-en',
            status: 'APPROVED',
          },
        ],
      },
      { data: { id: 'draft-kn' } },
    ];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));

    expect(res.status).toBe(201);
    expect(inserts[0].row).toMatchObject({
      name: 'contact_number_update',
      language: 'kn',
      category: 'Marketing',
      status: 'DRAFT',
      translation_reviewed_at: null,
    });
  });

  it('[CLG-003] keeps the builder category for a name new to Meta', async () => {
    queues['message_templates'] = [
      { data: null },
      { data: [] },
      { data: { id: 'draft-kn' } },
    ];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));

    expect(res.status).toBe(201);
    expect(inserts[0].row).toMatchObject({
      category: 'Utility',
      status: 'DRAFT',
    });
  });
});
