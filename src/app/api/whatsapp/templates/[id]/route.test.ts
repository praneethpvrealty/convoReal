import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNumberChangeTemplatePayload } from '@/lib/whatsapp/number-change-template';

/**
 * PATCH /api/whatsapp/templates/[id] — the Meta edit. For a translation
 * this is how a rejected row goes back to Meta, so the gate holds here:
 * only the signed-off wording may be sent.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let updates: Array<{ table: string; row: Record<string, unknown> }>;
const editMessageTemplate = vi.fn();

function next(table: string): QueuedResponse {
  return (queues[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        update: (row: unknown) => {
          updates.push({ table, row: row as Record<string, unknown> });
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

vi.mock('@/lib/whatsapp/meta-api', () => ({
  editMessageTemplate: (...args: unknown[]) => editMessageTemplate(...args),
  deleteMessageTemplate: vi.fn(),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
}));

vi.mock('@/lib/whatsapp/template-showcase-buttons', () => ({
  withAccountShowcaseButtons: async (
    _db: unknown,
    _account: string,
    payload: unknown
  ) => payload,
}));

import { PATCH } from './route';

const ID = '0b6b4a2e-6f4e-4b1c-9d2a-3c1f1e6a7b8c';
const context = { params: Promise.resolve({ id: ID }) };

function makeRequest(body: unknown) {
  return new Request(`http://test/api/whatsapp/templates/${ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const kannada = buildNumberChangeTemplatePayload('kn');

const REJECTED_KN = {
  id: ID,
  name: kannada.name,
  status: 'REJECTED',
  category: 'Marketing',
  meta_template_id: 'meta-kn',
  language: 'kn',
  body_text: kannada.body_text,
  footer_text: kannada.footer_text ?? null,
  translation_reviewed_at: '2026-09-22T04:00:00Z',
};

beforeEach(() => {
  queues = {};
  updates = [];
  editMessageTemplate.mockReset();
  editMessageTemplate.mockResolvedValue({ success: true });
  delete process.env.WHATSAPP_TEMPLATES_DRY_RUN;
});

describe('PATCH /api/whatsapp/templates/[id]', () => {
  it('[CLG-004] re-submits a rejected translation carrying its signed-off wording', async () => {
    queues['message_templates'] = [
      { data: REJECTED_KN },
      { data: { ...REJECTED_KN, status: 'PENDING' } },
    ];
    queues['whatsapp_config'] = [
      { data: { waba_id: 'waba-1', access_token: 'enc' } },
    ];

    const res = await PATCH(
      makeRequest({ ...kannada, category: 'Marketing' }),
      context
    );

    expect(res.status).toBe(200);
    expect(editMessageTemplate).toHaveBeenCalledTimes(1);
    expect(editMessageTemplate.mock.calls[0][0].metaTemplateId).toBe('meta-kn');
    expect(updates[0].row).toMatchObject({ status: 'PENDING' });
  });

  it('[CLG-004] refuses an edit whose wording differs from the signed-off copy', async () => {
    queues['message_templates'] = [{ data: REJECTED_KN }];

    const res = await PATCH(
      makeRequest({
        ...kannada,
        category: 'Marketing',
        body_text: `${kannada.body_text} ಧನ್ಯವಾದಗಳು`,
      }),
      context
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('TRANSLATION_REVIEW_REQUIRED');
    expect(editMessageTemplate).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('[CLG-004] refuses an edit of an unreviewed translation', async () => {
    queues['message_templates'] = [
      { data: { ...REJECTED_KN, translation_reviewed_at: null } },
    ];

    const res = await PATCH(
      makeRequest({ ...kannada, category: 'Marketing' }),
      context
    );

    expect(res.status).toBe(409);
    expect(editMessageTemplate).not.toHaveBeenCalled();
  });

  it('[CLG-004] leaves English edits ungated', async () => {
    const english = buildNumberChangeTemplatePayload('en');
    queues['message_templates'] = [
      {
        data: {
          ...REJECTED_KN,
          language: 'en_US',
          status: 'APPROVED',
          body_text: 'old words',
          translation_reviewed_at: null,
        },
      },
      { data: { id: ID, status: 'PENDING' } },
    ];
    queues['whatsapp_config'] = [
      { data: { waba_id: 'waba-1', access_token: 'enc' } },
    ];

    const res = await PATCH(
      makeRequest({ ...english, category: 'Marketing' }),
      context
    );

    expect(res.status).toBe(200);
    expect(editMessageTemplate).toHaveBeenCalledTimes(1);
  });
});
